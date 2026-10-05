#!/usr/bin/env python3
"""Synchronize an actual view-only wallet and export exact received-note records.

No credentials or spend operations are exposed. Output resembles the narrow
transaction records used by Sealed, but this is not a Zallet RPC server.
"""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import tomllib
import uuid

POOLS = {2: 'sapling', 3: 'orchard', 4: 'ironwood'}


def require_view_only(db, config):
    if config.get('network') != 'test' or config.get('mnemonic'):
        raise ValueError('Only testnet wallets without mnemonics are allowed')
    rows = db.execute('SELECT uuid,account_kind,hd_seed_fingerprint,hd_account_index FROM accounts').fetchall()
    if len(rows) != 1 or rows[0][1] != 1 or rows[0][2] is not None or rows[0][3] is not None:
        raise ValueError('Expected one dedicated viewing-only account')
    return str(uuid.UUID(bytes=rows[0][0]))


def snapshot(db, config, required_height):
    """All queries use one read transaction after successful upstream sync."""
    db.row_factory = sqlite3.Row
    account = require_view_only(db, config)
    # Upstream ReceiverFlags uses bit 2 for Sapling and bit 3 for Orchard.
    # Include only externally scoped shielded destinations stored for this account.
    receiving_addresses = [row[0] for row in db.execute('''
        SELECT DISTINCT a.address FROM addresses a JOIN accounts ac ON ac.id=a.account_id
        WHERE a.key_scope=0 AND (a.receiver_flags & 12) != 0 ORDER BY a.address
    ''')]
    if db.execute('SELECT COUNT(*) FROM scan_queue WHERE priority > 10').fetchone()[0]:
        raise ValueError('Wallet still has unscanned or unverified ranges')
    tip = db.execute('SELECT MAX(height) FROM blocks').fetchone()[0]
    if tip is None or tip < required_height:
        raise ValueError('Scanned wallet height is behind the verified server target')
    rows = db.execute('''SELECT t.txid,t.mined_height,t.expiry_height,b.hash,b.time,
        ro.pool,ro.output_index,ro.value,ro.memo,ro.is_change,ro.sent_note_id,
        a.address,a.key_scope
        FROM v_received_outputs ro
        JOIN transactions t ON t.id_tx=ro.transaction_id
        JOIN accounts ac ON ac.id=ro.account_id
        LEFT JOIN blocks b ON b.height=t.mined_height
        LEFT JOIN addresses a ON a.id=ro.address_id
        WHERE ro.pool IN (2,3,4)
        ORDER BY t.id_tx,ro.pool,ro.output_index''').fetchall()
    transactions = {}
    identities = set()
    for row in rows:
        if len(row['txid']) != 32 or row['output_index'] < 0:
            raise ValueError('Invalid transaction/output identity in wallet')
        txid = bytes(row['txid'])[::-1].hex()
        identity = (txid, row['pool'], row['output_index'])
        if identity in identities:
            raise ValueError('Duplicate received output identity')
        identities.add(identity)
        height = row['mined_height']
        if height is not None and (row['hash'] is None or row['time'] is None or height > tip):
            raise ValueError('Mined note has no verified scanned block')
        if row['value'] < 0 or row['value'] > 2_100_000_000_000_000:
            raise ValueError('Received-note value outside Zcash money range')
        expired = height is None and row['expiry_height'] not in (None, 0) and row['expiry_height'] <= tip
        tx = transactions.setdefault(txid, {
            'txid': txid, 'confirmations': tip-height+1 if height is not None else 0,
            'status': 'mined' if height is not None else ('expired' if expired else 'waiting'),
            'outputs': [],
        })
        if height is not None:
            tx.update(blockhash=bytes(row['hash'])[::-1].hex(), blocktime=row['time'])
        output = {
            'pool': POOLS[row['pool']],
            'output' if row['pool'] == 2 else 'action': row['output_index'],
            'account_uuid': account,
            'outgoing': row['sent_note_id'] is not None,
            'walletInternal': bool(row['is_change']) or row['key_scope'] != 0,
            'valueZat': row['value'],
        }
        # Unknown recipient binding stays absent and cannot match an invoice.
        if row['address'] is not None:
            output['address'] = row['address']
        memo = row['memo']
        if memo is not None:
            memo = bytes(memo)
            if len(memo) > 512:
                raise ValueError('Oversize stored shielded memo')
            if memo and memo[0] < 0xF5:
                try:
                    output['memoStr'] = memo.rstrip(b'\0').decode('utf-8')
                except UnicodeDecodeError as error:
                    raise ValueError('Invalid UTF-8 text memo') from error
        tx['outputs'].append(output)
    return {'network': 'test', 'accountUuid': account, 'receivingAddresses': receiving_addresses,
            'scannedHeight': tip,
            'serverTargetHeight': required_height, 'observedAt': int(time.time()),
            'transactions': list(transactions.values())}


def cli():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--wallet', required=True, type=Path)
    parser.add_argument('--address-verifier', type=Path)
    parser.add_argument('--destination', action='append', default=[])
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    wallet = args.wallet.resolve(strict=True)
    config = tomllib.loads((wallet/'keys.toml').read_text())
    uri = (wallet/'data.sqlite').as_uri() + '?mode=ro'
    with sqlite3.connect(uri, uri=True) as db:
        require_view_only(db, config)
    command = [str(binary), 'wallet', '-w', str(wallet)]
    def run(*parts):
        result = subprocess.run(command+list(parts), capture_output=True, text=True, timeout=240)
        if result.returncode:
            raise ValueError('Upstream wallet command failed; no snapshot emitted')
        return result.stdout
    info = json.loads(run('get-info', '-s', 'zecrocks'))
    if info.get('chain_name') != 'test' or not isinstance(info.get('chain_tip_height'), int):
        raise ValueError('Server must report public testnet')
    if info['chain_tip_height'] < 4_465_026:
        raise ValueError('Server is behind NU7 activation')
    run('sync', '-s', 'zecrocks')
    run('enhance', '-s', 'zecrocks')
    with sqlite3.connect(uri, uri=True) as db:
        db.execute('BEGIN')
        value = snapshot(db, config, info['chain_tip_height'])
    value['destinationBindings'] = []
    if args.destination and not args.address_verifier:
        raise ValueError('Destination ownership requires the official SDK address verifier')
    for destination in sorted(set(args.destination)):
        result = subprocess.run([str(args.address_verifier.resolve(strict=True)), '--wallet', str(wallet),
                                 '--address', destination], capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise ValueError('Official SDK could not verify destination ownership')
        binding = json.loads(result.stdout)
        if (binding.get('bindingVersion') != 1 or binding.get('network') != 'test'
                or binding.get('accountUuid') != value['accountUuid']
                or binding.get('destination') != destination):
            raise ValueError('Address verifier returned a mismatched account or destination')
        value['destinationBindings'].append({'destination': destination, 'receivers': binding['receivers']})
        value['receivingAddresses'] = sorted(set(value['receivingAddresses'] +
                                                 [destination, binding['canonicalDestination']]))
    print(json.dumps(value))


if __name__ == '__main__':
    try:
        cli()
    except Exception as error:
        print(f'View-only scanner failed: {error}', file=sys.stderr)
        sys.exit(1)
