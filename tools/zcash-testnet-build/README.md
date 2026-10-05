# NU7 testnet wallet build

This overlay ports a narrow wallet command surface from official `zcash-devtool`
revision `5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8` to the official NU7 prerelease
crates. It does not modify protocol rules, IDs, activation heights, cryptography,
or transaction validation.

Plan before transformation: retain upstream wallet initialization, UFVK import,
mnemonic restoration, scanning, inspection and sending. Remove unrelated command
registrations (PCZT, multisig, migration, QR, TUI), then migrate the retained API
calls to the coordinated prerelease dependency set. Use upstream functionality
and constructor defaults rather than recreating Zcash algorithms. Compile on a
standard hosted macOS arm64 runner because local disk is insufficient.

The patch script fails if expected source anchors are absent. The workflow emits
build diagnostics even on failure; a binary is published only after successful
compile, protocol tests, and an ephemeral unfunded testnet sync. The build carries
no application credentials, wallet seeds, viewing keys, or existing wallet files.
Artifact upload paths are explicit and exclude runtime wallet directories.

This is a development build, not a security-audited wallet. Do not use mainnet
funds. Source migration must be compile-validated in the workflow before use.

`export-notes.py` runs the compiled official wallet's synchronization and
enhancement, then opens its database read-only. It refuses seeded accounts,
non-testnet wallets, incomplete scans, missing mined blocks, duplicate output
identities and invalid amounts/memos. It exports each received shielded output
with its real pool and output/action index; no amount aggregation or fabricated
recipient data. Spent received notes are retained by querying the upstream
received-output view rather than an unspent list.

Thirteen isolated SQLite fixture tests cover identity, memo, amount, recipient,
multiple outputs, reorgs and failure conditions. Unresolved incoming recipients
reject the entire snapshot, including an unresolved second note beside an otherwise
valid payment; missing scope is never treated as proof of an internal transfer. Those fixtures are not live
payment evidence. CI also exercises a real freshly generated UFVK-only wallet
with no funds; those checks do not replace a funded local test before enabling
payments. Current live evidence is recorded in `docs/zcash-testnet.md`.

`address-bindings/` is a small read-only helper using the same SDK/dependency
versions as the verified wallet. It proves external UFVK ownership, re-encodes
legacy addresses with the official library, and matches receiver objects per
shielded pool. Its six tests reject foreign receivers, wrong networks, internal
scope and mismatched diversifiers, and verify legacy encoding and pool isolation.
The exporter accepts `--address-verifier` and `--destination` to produce verified
pool-specific `destinationBindings`; the same stored UA's unrelated Sapling
receiver is never authorized by an Orchard-only destination.
