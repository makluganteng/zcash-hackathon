# Dedicated Zcash testnet wallets

## Current state: public auction invoice settlement verified

A custom build using the official NU7 prerelease wallet crates passed [hosted compilation, protocol tests and real testnet scanning](https://github.com/makluganteng/zcash-hackathon/actions/runs/37362246450). The existing dedicated sender and seller were restored into separate directories, and a separate UFVK-only receiver was imported. The new SDK re-encodes viewing keys and addresses as ZIP 316 Revision 2; canonicalized original viewing keys match the restored accounts exactly.

The sender independently discovered **0.125 TAZ** from the Valar faucet, transaction `735e1eb422d15ff916c4d9788edbd2bbbe5f54db4dc37b1dab5c209a22075e06`, mined at height `4468432`. A separate **10,000-zatoshi shielded probe** to the original seller destination was decrypted by the viewing-only receiver: transaction `d05b718f7b6ab6114ea90f01a45be0146d777c1fa7bb2c3b8e1c407b420395f9`, Ironwood action 0, 11 confirmations at scan height `4468480`, exact private memo match. This is a real payment test, **not an auction invoice settlement**.

The stored receiver is a `tutest1` Revision 2 address while existing auction contracts commit an Orchard-only legacy `utest1` address. The official-SDK helper passed six local tests and verified the original seller's external UFVK ownership. At scan height `4468507`, it matched the real probe's exact Ironwood receiver with 38 confirmations and rejected Sapling authorization for that same stored mixed address. Prefix substitution and blanket aliases are not used. Auction payment readiness additionally requires the attended worker's fresh, successful scanner heartbeat.

The verified CLI and helper now reside durably under `.tools/zcash-nu7/`; restored wallets are under `.data/zcash-nu7/wallets/{sender,seller,scanner}` with protected permissions. Original recovery files under `.data/zcash-zingo` remain unchanged. The coordinator migrated the runtime after stopping the worker, verified copied hashes and SQLite integrity, and restarted the worker on the durable paths. `.data/zcash-nu7-runtime.json` is authoritative for paths and checksums. The worker still runs on this Mac; durable storage is not a hosted always-on worker service.

A private 512 MiB RAM volume was used temporarily when persistent storage could not allocate the executable or source edits. That workaround is historical: binaries, wallets and proof tools were restored to physical storage before the RAM volume was retired. Reboot no longer destroys the active wallet/runtime files.

The address verifier is `.tools/zcash-nu7/sealed-address-bindings`, SHA-256 `a31963ba1021f6ce158190216de9adf310ede5418c460501005d0fb609fcd3c9`. It was built locally with Rust 1.94 after sufficient disk headroom returned; all selected dependency versions are a subset of the verified wallet's lockfile. Local build/test logs are in `.data/zcash-nu7/build-evidence/`. The [ARM helper CI attempt](https://github.com/makluganteng/zcash-hackathon/actions/runs/37367479799) never obtained a runner during GitHub's [scheduling incident](https://www.githubstatus.com/incidents/3q1yb5m7ltvb); this was an infrastructure failure, not a test failure. The [standard Intel macOS fallback](https://github.com/makluganteng/zcash-hackathon/actions/runs/37369290208) subsequently passed. The [hardened exporter/helper CI run](https://github.com/makluganteng/zcash-hackathon/actions/runs/37370344042) also passed, independently validating the final receiver checks. The active runtime remains the locally verified ARM binary.

The helper emits pool-specific `destinationBindings`, and the exporter adds original/canonical destination spellings only after official SDK ownership verification. The persisted account UUID is `f3a41573-8851-45f4-93ca-bb70efc56fc4`. Both the helper and exporter reject seeded scanner accounts. The worker now owns scanner synchronization; manual wallet mutation must be coordinated with it.

The actual winner invoice for public auction `2` subsequently settled: exactly **0.03 TAZ**, the exact private invoice memo, one Ironwood output, and at least three receiver-observed confirmations. The authenticated hosted invoice API returned `receiver-confirmed`; the database was not manually changed to report payment. The separate probe above remains distinct from this invoice settlement.

An independent review also found and closed a missing-recipient edge case. Incoming non-change notes with unknown scope or recipient now reject the complete export, rather than being hidden as internal transfers. All 13 exporter regression tests pass, including a valid payment beside an unresolved second note.

The pinned scanner supports **native ZEC/TAZ only**: `orchard 0.16` notes contain a scalar `NoteValue`, and `zcash_client_sqlite 0.23.0-pre.0`'s Ironwood received-note schema has no asset identifier. [NU7's deployment specification](https://zips.z.cash/zip-0259) adds no asset-bearing transaction format. The dependency pin is part of this guarantee; a future asset-capable SDK/schema requires explicit denomination validation before integration.

The public address manifest is `.data/zcash-zingo/public.json`. Wallets are separated into:

- `.data/zcash-zingo/sender`: dedicated testnet payer, including private recovery material.
- `.data/zcash-zingo/seller`: independent seller, including private recovery material.
- `.data/zcash-zingo/scanner`: seller UFVK imported into a separate viewing-only wallet. No recovery phrase or spending key.

The scanner reports `Loaded from unified full viewing key`, and its receiving address exactly matches the seller's. Directories use mode 0700 and files 0600. All reside under gitignored `.data`. These wallets are testnet-only. Recovery files are plaintext private key material protected by filesystem permissions; store private backups, never upload the sender/seller folders to a server, and never reuse the keys for mainnet.

## Historical protocol blocker, resolved by the custom build

The live `GetLightdInfo` gRPC call to `testnet.zec.rocks:443` returned:

- `chainName: test`
- `blockHeight: 4467762` during this run (advances normally)
- `consensusBranchId: 77190ad9`
- ECC LightWalletD v0.5.4 / Zebra v7.0.0-rc.0

The result was obtained with official `zcash/lightwallet-protocol` protobuf definitions and grpcurl 1.9.4, then independently reproduced through the native wallet API.

[Official librustzcash source at revision 9c5705f56517c040c50f96d29f1ff15a9383f3e0](https://github.com/zcash/librustzcash/blob/9c5705f56517c040c50f96d29f1ff15a9383f3e0/components/zcash_protocol/src/consensus.rs) defines **NU7 as `0x77190ad9`, active on testnet at block 4465026**. The live chain is already beyond that height.

[Zingo PC 2.0.26-194](https://github.com/zingolabs/zingo-pc/releases/tag/zingo-pc-2.0.26-194), published October 4, pins [Zingolib 9d80d9aea1cecbe4dea3e0bd8d84f32092c29fcd](https://github.com/zingolabs/zingolib/tree/9d80d9aea1cecbe4dea3e0bd8d84f32092c29fcd) and `zcash_protocol 0.10.6`. That protocol crate recognizes NU6.3 (`0x37a5165b`), but its optional NU7 value is still the placeholder `0xffffffff`.

Both Zingo PC 2.0.25-180 and 2.0.26-194 failed actual synchronization with:

```text
server returned invalid transaction. invalid consensus branch id 0x77190ad9
```

The scanner processed **zero outputs**. A reported latest chain height is merely observed server state, not successful wallet scanning. No branch validation was bypassed or transaction data altered. Recovery requires a wallet release/build that actually supports activated NU7.

Alternative endpoints `testnet.lightwalletd.com:9067` and `lightwalletd.testnet.electriccoin.co:9067` timed out. `lwd.testnet.zec.pro:443` closed the gRPC stream without trailers. These are local access results, not claims of global outages.

## Reproduce the local wallet checks

The Apple Silicon native addon was extracted from the official Zingo PC DMG, avoiding a full Rust build and without installing or opening the desktop application. The app is not a project dependency. Source interface: [native/src/lib.rs](https://github.com/zingolabs/zingo-pc/blob/zingo-pc-2.0.26-194/native/src/lib.rs).

```sh
curl -fL https://github.com/zingolabs/zingo-pc/releases/download/zingo-pc-2.0.26-194/Zingo.PC-2.0.26-194-arm64.dmg -o .tools/zingo-pc-arm64.dmg
hdiutil attach -readonly -nobrowse .tools/zingo-pc-arm64.dmg
mkdir -p .tools/zingo-native
cp '/Volumes/Zingo PC 2.0.26-arm64/Zingo PC.app/Contents/Resources/app.asar.unpacked/build/native.node' .tools/zingo-native/native.node
hdiutil detach '/Volumes/Zingo PC 2.0.26-arm64'
node scripts/zcash-zingo-wallet.mjs status scanner
node scripts/zcash-zingo-wallet.mjs sync scanner
```

The helper validates SHA-256 `b8dde1aba4c44945533d458f076cdae64c1bcd00e64de67459f25f7d9fc704be` before loading the inspected addon. It never prints seeds or viewing keys. `sync` currently exits nonzero with the actual consensus error. It never updates Sealed's payment readiness or fabricates confirmations.

On a fresh setup, `bootstrap sender`, then `bootstrap seller`, then `bootstrap scanner` creates separate wallets. It is restartable and does not replace existing wallets. Only `status`, `sync` and `bootstrap` are exposed; there is no sending API or public RPC server. A future native-binary upgrade requires source/API validation and an intentional checksum update.

## Invoice adapter boundary

Zingo's native addon exposes **aggregated value transfers**, not per-note observations. Incoming rows have `recipient_address: null` and omit output indices. `get_messages` uses the same aggregate. See the [upstream transfer fixture](https://github.com/zingolabs/zingolib/blob/9d80d9aea1cecbe4dea3e0bd8d84f32092c29fcd/zingolib/tests/golden/value_transfers.json).

These fields cannot safely be invented to satisfy Sealed's Zallet adapter. No compatibility proxy was implemented and no invoice was marked paid. Exact payment matching still needs an actual Zallet receiver or a separately implemented and tested per-note light-wallet adapter.

The official [zcash-devtool walkthrough](https://github.com/zcash/zcash-devtool/blob/main/doc/walkthrough.md) provides a promising future path: encrypted seeds, UFVK-only wallets, and a SQLite wallet database exposing per-note identity, amount, memo, recipient, block time and mined height. However, the attempted source revision `5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8` resolves the same incompatible protocol crate. Its release build also exhausted local disk while compiling SQLite. Only the failed build's generated `target` directory was removed, recovering roughly 1.4 GiB. A future attempt requires an NU7-compatible dependency set and several GiB of free disk.

[Zallet releases](https://github.com/zcash/zallet/releases) provide Linux arm64/amd64 binaries, but no macOS binary. A Linux-hosted Zallet plus compatible Zebra is another option. Do not place lightwalletd's gRPC URL into `ZALLET_RPC_URL` or `ZCASH_NODE_RPC_URL`; those variables require different JSON-RPC APIs.

## Historical faucet failures

Candidate community faucets are [Jino Labs](https://zcashfaucet.jinolabs.xyz/) and [ZECpages](https://faucet.zecpages.com/). Both failed from the shell and browser in this run. `faucet.testnet.z.cash` also failed TLS. No request was successfully submitted and no testnet funds were received.

Once an NU7-compatible wallet and working faucet are available, fund the **sender** address from the private local public manifest, send the claimed invoice's exact amount and encrypted memo to its destination, and verify the actual received note plus confirmations through the configured receiver. Never treat funding requests, wallet creation, mock responses, or chain-height observations as payment evidence.


## Follow-up investigation — 2026-10-06

### Faucet request accepted, not independently confirmed

A newly checked provider, [Fauzec](https://fauzec.com/), exposes a [published OpenAPI contract](https://fauzec.com/.well-known/openapi.json) and documents automated testnet claims. Its network endpoint returned `testnet`, supported Unified/Sapling addresses, and an open launch phase. Its health endpoint responded successfully.

Exactly one idempotent request for **1 TAZ** was submitted to the dedicated sender. The provider returned HTTP 200, `outcome: accepted`, `state: broadcasting`, and a transaction ID. Request metadata is stored privately at `.data/zcash-zingo/fauzec-claim.json`. Retrying must poll the existing request rather than submit another drip.

- Request ID: `22f8e8e9-dcdf-4452-86ac-9e43de7f0846`
- Provider-reported transaction: `494fec2b35682c2930e65c8d6ac4f36f83139bcf1724ba976a5957ccbb5d9712`
- Status route: `GET https://fauzec.com/api/v1/status/testnet/22f8e8e9-dcdf-4452-86ac-9e43de7f0846`

The provider subsequently reported `confirmed` at height `4466369`. However, a fresh independent `GetTransaction` query to `testnet.zec.rocks` still returned **NotFound** (not in its mempool or best chain). The claimed confirmation height is also earlier than the new sender wallet birthday (`4467650`). This unresolved provider/chain discrepancy is not proof of funded balance, recipient discovery, or a completed auction payment; do not request another drip merely to mask it. Fauzec's reported scanned and chain-tip heights were also inconsistent (`4466363` versus `4466063`), so its `ready` label cannot substitute for independent chain verification.

A further provider, [Zakura's NU7 dashboard](https://zakura.com/nu7/), now identifies the public-testnet network correctly but explicitly says no verified faucet is available. Its earlier staging faucet must not be confused with public-testnet funding. `testnet.zecfaucet.com` did not resolve from this machine.

### Published NU7 wallet crates provide a concrete upgrade path

NU7 support is already available in the official **published prerelease crates**, not only an unreleased Git branch. The downloaded `zcash_protocol 0.11.0-pre.0` source was inspected directly: it contains `0x77190ad9`, public-testnet activation `4465026`, and removes the old NU7 build-flag gate.

The coordinated dependency set is:

| Crate | Published NU7 prerelease |
| --- | --- |
| `zcash_protocol` | `0.11.0-pre.0` |
| `zcash_address` | `0.14.0-pre.0` |
| `zcash_transparent` | `0.11.0-pre.0` |
| `zcash_primitives`, `zcash_proofs` | `0.31.0-pre.0` |
| `zcash_keys` | `0.17.0-pre.0` |
| `pczt` | `0.10.0-pre.0` |
| `zcash_client_backend` | `0.25.0-pre.0` |
| `zcash_client_sqlite` | `0.23.0-pre.0` |
| `zcash_pool_migration` | `0.2.0-pre.0` |

Sources: [protocol changelog](https://docs.rs/crate/zcash_protocol/0.11.0-pre.0/source/CHANGELOG.md), [wallet backend changelog](https://docs.rs/crate/zcash_client_backend/0.25.0-pre.0/source/CHANGELOG.md), [SQLite wallet changelog](https://docs.rs/crate/zcash_client_sqlite/0.23.0-pre.0/source/CHANGELOG.md).

This is a coordinated migration rather than a one-line branch-ID patch. The backend also moves to `orchard 0.16`, `sapling-crypto 0.9`, `rand/rand_core 0.10`, `group 0.14`, `jubjub 0.11`, `incrementalmerkletree 0.9`, `shardtree 0.8`, `bip32 0.6`, `secp256k1 0.33`, `zcash_script 0.6`, `zcash_note_encryption 0.5`, `zip32 0.3`, and `zip321 0.10.0-pre.0`. Transaction creation/proving/signing entry points now require explicit clock and RNG arguments. `Clock`/`SystemClock` move into the wallet backend utility module. Address generation and validation must respect ZIP 316 Revision 2 behavior and expiry.

Rechecking official binary sources found no usable upgrade: Zingo PC still has the same 2.0.26-194 release; Zallet's current Git dependency pin also lacks the real NU7 branch; the [October 5 devtool CI run](https://github.com/zcash/zcash-devtool/actions/runs/37298835078) builds the same old source revision on Ubuntu. Downloading its artifact would neither provide macOS compatibility nor fix the protocol version.

### Bounded remote build plan

Local free space was approximately 290 MiB at the start of this follow-up. No local Rust build or large artifact download was attempted. The next implementation path is:

1. Use an isolated checkout of devtool revision `5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8`; update the entire dependency set above to exact versions and preserve a generated lockfile. Do not alter consensus IDs or weaken transaction parsing.
2. Port the affected address, clock, RNG, and cryptographic APIs. Start with wallet initialization, UFVK import, synchronization, transaction inspection, and sending. Run `cargo check` on a remote runner to obtain real compiler diagnostics; this migration has not been compile-validated yet.
3. Build on an authenticated GitHub Actions Apple Silicon runner matching this machine (`macos-15`, explicitly assert `uname -m == arm64`). Use Rust 1.88 or newer, `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_RELEASE_DEBUG=0`, and a locked release build after the diagnostic phase. A Linux artifact is an alternative only if the final worker host is Linux.
4. Give the workflow read-only repository permissions and no wallet, seed, UFVK, RPC, or application secrets. Upload only the binary, dependency lockfile, source revision, and checksum. Test an ephemeral wallet or public chain metadata in CI; import the actual viewing key only locally afterward.
5. Verify the artifact provenance/checksum, then import the existing seller UFVK into a new devtool scanner directory and successfully scan from the persisted birthday. Test sending from a separate restored payer only after the faucet transfer is independently visible and the wallet supports current consensus.
6. Implement a per-note adapter over the official SQLite wallet schema, with real note identities, destination binding, memo matching, spent-note history, complete-scan checks and reorg tests. Keep payment readiness false until an actual invoice payment passes this path.

The explicit-dispatch workflow `.github/workflows/zcash-testnet-wallet.yml` and a wallet-only source overlay under `tools/zcash-testnet-build/` are now prepared for review. The overlay applies cleanly to the pinned upstream checkout; nine per-note exporter fixtures pass. Remote compilation and actual wallet scanning remain required. No private wallet material is included in the workflow or its artifact allowlist. The coordinating agent controls repository push and dispatch.
