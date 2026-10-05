import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('export_notes', Path(__file__).with_name('export-notes.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NoteSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript('''
        CREATE TABLE accounts(id INTEGER,uuid BLOB,account_kind INTEGER,hd_seed_fingerprint BLOB,hd_account_index INTEGER);
        CREATE TABLE scan_queue(priority INTEGER);
        CREATE TABLE blocks(height INTEGER,hash BLOB,time INTEGER);
        CREATE TABLE transactions(id_tx INTEGER,txid BLOB,mined_height INTEGER,expiry_height INTEGER);
        CREATE TABLE addresses(id INTEGER,address TEXT,key_scope INTEGER,account_id INTEGER,receiver_flags INTEGER);
        CREATE TABLE v_received_outputs(transaction_id INTEGER,account_id INTEGER,address_id INTEGER,pool INTEGER,output_index INTEGER,value INTEGER,memo BLOB,is_change INTEGER,sent_note_id INTEGER);
        ''')
        self.db.execute('INSERT INTO accounts VALUES(1,?,1,NULL,NULL)', (bytes(range(16)),))
        self.db.execute('INSERT INTO blocks VALUES(4465030,?,1000)', (bytes(range(32)),))
        self.db.execute('INSERT INTO blocks VALUES(4465032,?,1050)', (bytes(range(32)),))
        self.db.execute('INSERT INTO transactions VALUES(1,?,4465030,4465050)', (bytes(range(32)),))
        self.db.execute("INSERT INTO addresses VALUES(1,'utest1fixture',0,1,8)")
        self.db.execute('INSERT INTO v_received_outputs VALUES(1,1,1,4,7,500000,?,0,NULL)', (b'invoice-123'+bytes(501),))
        self.config = {'network': 'test'}

    def tearDown(self):
        self.db.close()

    def read(self):
        return module.snapshot(self.db, self.config, 4465032)

    def test_uses_actual_note_identity_amount_recipient_and_mined_block(self):
        tx = self.read()['transactions'][0]
        self.assertEqual(tx['txid'], bytes(range(32))[::-1].hex())
        self.assertEqual(tx['confirmations'], 3)
        self.assertEqual(tx['blocktime'], 1000)
        out = tx['outputs'][0]
        self.assertEqual((out['pool'],out['action'],out['valueZat'],out['memoStr']), ('ironwood',7,500000,'invoice-123'))
        self.assertEqual(out['address'],'utest1fixture')
        self.assertFalse(out['walletInternal'])

    def test_two_notes_remain_two_outputs_and_cannot_be_aggregated(self):
        self.db.execute('INSERT INTO v_received_outputs VALUES(1,1,1,4,8,1,?,0,NULL)', (b'invoice-123',))
        self.assertEqual(len(self.read()['transactions'][0]['outputs']), 2)

    def test_owned_addresses_exclude_internal_and_transparent_destinations(self):
        self.db.execute("INSERT INTO addresses VALUES(2,'utest1internal',1,1,8)")
        self.db.execute("INSERT INTO addresses VALUES(3,'tmTransparent',0,1,1)")
        self.db.execute('DELETE FROM v_received_outputs')
        self.assertEqual(self.read()['receivingAddresses'], ['utest1fixture'])

    def test_missing_address_remains_unmatchable(self):
        self.db.execute('UPDATE v_received_outputs SET address_id=NULL')
        self.assertNotIn('address',self.read()['transactions'][0]['outputs'][0])

    def test_internal_and_sent_notes_are_marked(self):
        self.db.execute('UPDATE addresses SET key_scope=1')
        self.db.execute('UPDATE v_received_outputs SET sent_note_id=7')
        out=self.read()['transactions'][0]['outputs'][0]
        self.assertTrue(out['walletInternal'])
        self.assertTrue(out['outgoing'])

    def test_reorg_loses_confirmations(self):
        self.db.execute('UPDATE transactions SET mined_height=NULL')
        tx=self.read()['transactions'][0]
        self.assertEqual(tx['confirmations'],0)
        self.assertEqual(tx['status'],'waiting')
        self.assertNotIn('blocktime',tx)

    def test_incomplete_scan_fails(self):
        self.db.execute('INSERT INTO scan_queue VALUES(50)')
        with self.assertRaises(ValueError):self.read()

    def test_missing_mined_block_fails(self):
        self.db.execute('DELETE FROM blocks WHERE height=4465030')
        with self.assertRaises(ValueError):self.read()

    def test_duplicate_output_fails(self):
        self.db.execute('INSERT INTO v_received_outputs SELECT * FROM v_received_outputs')
        with self.assertRaises(ValueError):self.read()

    def test_spending_authority_or_wrong_network_fails(self):
        for config in [{'network':'main'},{'network':'test','mnemonic':'fixture'}]:
            with self.assertRaises(ValueError):module.snapshot(self.db,config,4465032)
        self.db.execute('UPDATE accounts SET account_kind=0')
        with self.assertRaises(ValueError):self.read()


if __name__ == '__main__':
    unittest.main()
