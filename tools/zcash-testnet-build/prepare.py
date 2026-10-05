#!/usr/bin/env python3
"""Apply a bounded, anchor-checked overlay to the pinned upstream checkout."""
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).resolve()
overlay = Path(__file__).resolve().parent
cargo = source / 'Cargo.toml'
text = cargo.read_text()
versions = {
 'orchard': '0.16', 'pczt': '=0.10.0-pre.0', 'sapling': '0.9',
 'transparent': '=0.11.0-pre.0', 'zcash_address': '=0.14.0-pre.0',
 'zcash_client_backend': '=0.25.0-pre.0', 'zcash_client_sqlite': '=0.23.0-pre.0',
 'zcash_keys': '=0.17.0-pre.0', 'zcash_pool_migration': '=0.2.0-pre.0',
 'zcash_primitives': '=0.31.0-pre.0', 'zcash_proofs': '=0.31.0-pre.0',
 'zcash_protocol': '=0.11.0-pre.0', 'zcash_script': '0.6',
 'zip32': '0.3', 'zip321': '=0.10.0-pre.0', 'rand': '0.10',
 'bip32': '0.6', 'jubjub': '0.11', 'group': '0.14', 'secp256k1': '0.33',
 'incrementalmerkletree': '0.9', 'shardtree': '0.8', 'zcash_note_encryption': '0.5',
 'zcash_encoding': '0.5',
}
for name, version in versions.items():
    pattern = rf'(?m)^({re.escape(name)}\s*=\s*)(?:"[^"]+"|(?P<table>\{{[^\n]*?version\s*=\s*)"[^"]+")'
    def replacement(match):
        return match.group(1) + (match.group('table') or '') + '"' + version + '"'
    text, count = re.subn(pattern, replacement, text)
    if count != 1:
        raise RuntimeError(f'Expected one dependency {name}, got {count}')
text = text.replace('[dependencies]\n', '[dependencies]\nrand_core = "0.10"\n', 1)
text = text.replace('rand = { version = "0.10", default-features = false }', 'rand = { version = "0.10", features = ["sys_rng"] }')
cargo.write_text(text)

# Retain official selected command implementation files; expose only these modules.
commands = (source / 'src/commands.rs').read_text()
select = commands[commands.index('pub(crate) fn select_account'):]
(source / 'src/commands.rs').write_text('''use anyhow::anyhow;
use clap::Args;
use uuid::Uuid;
use zcash_client_backend::data_api::WalletRead;
use zcash_client_sqlite::AccountUuid;
pub(crate) mod wallet;
#[derive(Debug, Args)]
pub(crate) struct Wallet {
    #[arg(short, long)] pub(crate) wallet_dir: Option<String>,
    #[command(subcommand)] pub(crate) command: wallet::Command,
}
''' + select)
modules = ['init', 'init_fvk', 'restore_mnemonic', 'get_info', 'sync', 'enhance',
           'balance', 'list_accounts', 'list_addresses', 'list_tx', 'send']
(source / 'src/commands/wallet.rs').write_text(
    'use clap::Subcommand;\n' + ''.join(f'pub(crate) mod {m};\n' for m in modules) +
    '#[derive(Debug, Subcommand)]\npub(crate) enum Command {\n' +
    ''.join(f'    {"".join(word.title() for word in m.split("_"))}({m}::Command),\n' for m in modules) + '}\n')
(source / 'src/main.rs').write_text((overlay / 'main.rs').read_text())

files = [source / 'src/data.rs', *(source / f'src/commands/wallet/{m}.rs' for m in modules)]
for file in files:
    s = file.read_text()
    s = s.replace('use rand::rngs::OsRng;', 'use crate::WalletRng;')
    s = s.replace('OsRng', 'WalletRng')
    if file.name in ('enhance.rs', 'send.rs'):
        s = s.replace('use crate::WalletRng;\n', '')
    if file.name == 'init_fvk.rs':
        s = s.replace('|(network, ufvk)|', '|(network, _revision, ufvk)|')
    s = s.replace('SystemClock, WalletRng)?', 'SystemClock, crate::wallet_rng())?')
    s = s.replace('use zcash_client_sqlite::util::SystemClock;', 'use zcash_client_backend::util::SystemClock;')
    s = s.replace('use zcash_client_sqlite::{WalletDb, util::SystemClock};',
                  'use zcash_client_sqlite::WalletDb;\nuse zcash_client_backend::util::SystemClock;')
    s = s.replace('error::SqliteClientError, util::SystemClock,', 'error::SqliteClientError,')
    if file.name == 'sync.rs':
        s = 'use zcash_client_backend::util::SystemClock;\n' + s
    s = s.replace('UnifiedAddress::from_receivers(Some(*addr), None, None)',
                  'UnifiedAddress::from_receivers(Some(*addr), None, None, None, None)')
    file.write_text(s)

send = source / 'src/commands/wallet/send.rs'
s = send.read_text()
anchor = '        let txids = create_proposed_transactions(\n            &mut db_data,\n            &params,'
if s.count(anchor) != 1:
    raise RuntimeError('Transaction creation anchor changed')
s = s.replace(anchor, '        let txids = create_proposed_transactions(\n            &mut db_data,\n            &params,\n            &SystemClock,\n            &mut crate::wallet_rng(),')
send.write_text(s)

balance = source / 'src/commands/wallet/balance.rs'
s = balance.read_text()
s = s.replace('.get_latest_zec_to_usd_rate(&exchanges)', '.get_latest_zec_to_usd_rate(&mut crate::wallet_rng(), &exchanges)')
balance.write_text(s)

# This development artifact is intentionally testnet-only.
data = source / 'src/data.rs'
s = data.read_text().replace('"main" => Ok(Network::Main),', '"main" => Err("This build is testnet-only".to_string()),')
data.write_text(s)
print('Applied NU7 wallet-only overlay; compiler verification is still required.')
