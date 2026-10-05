// Operator-only testnet wallet helper. Never import this module into the web app.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, role] = process.argv.slice(2);
if (!['bootstrap', 'status', 'sync'].includes(command) || !['sender', 'seller', 'scanner'].includes(role)) {
  throw new Error('Usage: node scripts/zcash-zingo-wallet.mjs <bootstrap|status|sync> <sender|seller|scanner>');
}
process.umask(0o077);
const binary = path.join(root, '.tools/zingo-native/native.node');
const expectedHash = 'b8dde1aba4c44945533d458f076cdae64c1bcd00e64de67459f25f7d9fc704be';
if (createHash('sha256').update(await readFile(binary)).digest('hex') !== expectedHash) {
  throw new Error('Unexpected native binary; inspect and validate its source before updating this pin');
}
const native = createRequire(import.meta.url)(binary);
const directory = path.join(root, '.data/zcash-zingo', role);
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
native.set_wallet_base_dir(directory);
const connection = ['https://testnet.zec.rocks:443', 'test', 'Low', 3];
const name = `sealed-${role}.dat`;
const parse = (text) => JSON.parse(text);
let initialized = false;
try {
  if (!native.wallet_exists(...connection, name)) {
    if (command !== 'bootstrap') throw new Error('Create the dedicated wallet first');
    if (role === 'scanner') {
      const view = parse(await readFile(path.join(root, '.data/zcash-zingo/seller/viewing.json'), 'utf8'));
      native.init_from_ufvk(view.ufvk, view.birthday, ...connection, name);
    } else {
      // The binding returns recovery material. Persist privately; never log it.
      const recovery = native.init_new(...connection, name);
      await writeFile(path.join(directory, 'recovery.json'), recovery, { mode: 0o600, flag: 'wx' });
    }
  } else {
    native.init_from_b64(...connection, name);
  }
  initialized = true;
  const kind = parse(await native.wallet_kind());
  if (role === 'scanner' && kind.kind !== 'Loaded from unified full viewing key') {
    throw new Error('Refusing scanner containing spending authority');
  }
  if (command === 'bootstrap' && role !== 'scanner') {
    await writeFile(path.join(directory, 'viewing.json'), await native.get_ufvk(), { mode: 0o600 });
  }
  const server = parse(await native.info_server());
  if (server.chain_name !== 'test') throw new Error('Remote endpoint is not testnet');
  const addresses = parse(await native.get_unified_addresses());
  if (!addresses.length || addresses.some(item => !item.encoded_address.startsWith('utest1'))) {
    throw new Error('Wallet returned a non-testnet receiving address');
  }
  if (command === 'sync') {
    await native.run_sync();
    let finished = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const report = await native.poll_sync();
      if (report.startsWith('{')) {
        const result = parse(report);
        if (result.sync_failed) throw new Error(result.sync_failed.reason);
        if (result.sync_complete) { finished = true; break; }
      }
    }
    if (!finished) throw new Error('Sync did not complete; no payment readiness is asserted');
  }
  await native.save_wallet_file();
  const output = { role, walletKind: kind.kind, server, addresses,
    syncStatus: parse(await native.status_sync()), balance: parse(await native.get_balance()) };
  await writeFile(path.join(directory, 'status.json'), JSON.stringify(output, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  // No argv/key material is interpolated. Known upstream errors report protocol state.
  console.error(`Zcash ${command} failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (initialized) {
    try { await native.stop_sync(); await native.save_wallet_file(); } catch { /* preserve original error */ }
    native.deinitialize();
  }
}
