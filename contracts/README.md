# Auction evidence and real proof

The contract fixes the complete ordered list of at most 16 commitments and constructs
all 57 verifier inputs itself. No API-supplied bid list can replace it. The immutable
verifier validates SHA-256 openings, integer bounds, highest eligible amount, and
earliest insertion for ties. Zero bidders and below-reserve bids yield canonical
no-sale. No owner, upgrade proxy, arbitrary finalization, or ZEC custody exists.

## Reproduce

Requires Node 22+, Python 3, Foundry, and network access to official toolchain artifacts.
The installer only writes `.tools/` inside this repository.

```sh
bash scripts/proof-setup.sh
bash scripts/proof-build.sh
python3 scripts/proof-tests.py
forge test --root contracts -vv
# In another terminal:
anvil --host 127.0.0.1 --chain-id 31337
# Create an empty deployment suitable for the app:
npx tsx scripts/contract-deploy.ts
# Or execute a self-contained deployment, three bids, proof and finalization:
npx tsx scripts/contract-smoke.ts
npx tsx scripts/proof-verify.ts .local/smoke/deployment.json .local/smoke/proof/bundle.json 1
# Full-capacity measurement:
SMOKE_BIDS=16 npx tsx scripts/contract-smoke.ts
```

The smoke uses published Anvil test keys and deterministic fixture openings only.
It uses real commitments, signatures, proof generation, and EVM verification; its
ciphertext digests are synthetic because encryption is tested separately. This is
not the shielded-payment end-to-end test. Never send funds to fixture accounts.

`proof-run.py private-input.json output-directory` is the worker-facing entry point.
Private JSON contains rulesHash/reserve/maxAmount and ordered
`bids[{bidder,commitment,amount,nonce}]`. The worker must retrieve these from the
confirmed canonical registry and verified openings. The generated public bundle
contains result, 57 inputs, proof, and VK hash. Temporary witness files are isolated
and removed; the caller owns removal of its private JSON input.

The observer command reads a reviewed deployment manifest, verifies runtime code
hashes for the registry/verifier/libraries, checks the immutable verifier, loads the
canonical registry/result at one block, compares every public input and calls the
real verifier. On Base it uses the `finalized` block tag. Local fixtures explicitly
use `latest`; they make no public-chain finality claim. The manifest must come from
an independently trusted/reviewed deployment, not an untrusted proof publisher.

## Base Sepolia

```sh
# Supply through the environment or a private ignored env file. Never commit keys.
npx tsx --env-file=.env.local scripts/contract-deploy-base.ts
```

Requires `BASE_RPC_URL` and an explicitly funded `DEPLOYER_PRIVATE_KEY`. Refuses any
chain other than 84532. It never falls back to the local Anvil key. Writes
`.data/base-sepolia-deployment.json`; no public deployment was performed during
implementation because credentials/funding were not provided. The registry is
open to any seller; the web app currently supplies its configured demo seller.

## Resume an interrupted deployment

Both deploy commands save a private journal next to their manifest, for example
`.data/base-sepolia-deployment.journal.json`. It contains the chain, deployer,
source/build identities, nonce, signed transaction bytes, transaction hash, and
verified mined address/code hash for each library and contract. Journal files and
atomic-write temporary files use permission `0600`; public manifests contain no
keys or raw transactions. Keep the journal private and backed up until deployment
is complete.

If an RPC request times out, run the same command again with the same build,
account, and journal. The deployer checks canonical receipts and deployed code,
reuses verified contracts, and rebroadcasts only the exact saved transaction when
needed. It does not silently allocate a replacement nonce. A consumed nonce with
an unavailable receipt, changed source/build, wrong chain/signer, reverted
transaction, or changed runtime stops the process for inspection. Zero balance
stops any new broadcast; a completed deployment can still be verified without
funds. Another pending account nonce also blocks creation of a new transaction.

Do not delete the journal to recover a timeout: that discards the protection
against duplicate deployments. Public deployment refuses an existing manifest
without its corresponding journal. Avoid other transactions from the deployment
account while this process runs. Concurrent instances sharing a journal are
locked; a lock left by a dead process is recovered on the next invocation.

The focused regression uses only a fresh isolated local chain and restores its
snapshot afterward; it does not read app environment files or write app manifests:

```sh
anvil --host 127.0.0.1 --port 18548 --chain-id 31337
npx tsx tests/contracts/deployment.integration.ts
```

It checks zero funds, receipt timeout, unmined retry, mining before recovery,
identical transaction/nonce reuse, completed reuse without funds, wrong
chain/deployer/source, and changed deployed runtime. Source and bytecode checks
are deployment consistency checks, not an external security audit.

## Toolchain and measurements

Pinned compatible official pairing: Noir **1.0.0-beta.22**, Barretenberg
**5.0.0-nightly.20260522**, SHA-256 Noir library **v0.3.0**, solc **0.8.30**,
optimizer 200, `via_ir=false`. The EVM backend target is explicitly `evm` (ZK),
never `evm-no-zk`. Generated verifier links two deployed public libraries.

Measured locally on Apple ARM64, 2026-10-05:

| Measurement | Three bids | 16 bids |
| --- | --- | --- |
| Proving + native verification | 0.74 s | 0.72 s |
| Reported peak resident memory | ~350 MiB | ~346 MiB |
| Proof | 9,536 bytes | 9,536 bytes |
| Full registry finalization transaction | 2,882,259 gas | 2,949,817 gas |

Witness execution/compilation and deployments are excluded from proving duration.
The fixed-capacity circuit computes all slots regardless of active count. Verifier
runtime is 18,017 bytes; registry runtime 6,738 bytes. Local measurements establish
feasibility, not a Base gas-cost forecast or security audit.

## Protocol encoding

Rules hash: `keccak256(abi.encode(chainId, registryAddress, auctionId, Rules))`.
Rules field order is fixed in `src/lib/protocol.ts` / `PrivateAuction.Rules`.
Commitment: SHA-256 of exactly
`rulesHash[32] || bidderAddress[20] || amountUint64BE[8] || nonce[32]`.
EIP-712 envelope binds auction ID, rules hash, bidder, commitment, ciphertext hash.

Public input order:

- 0–1: rules hash high/low unsigned 128-bit halves.
- 2–4: reserve, maximum amount, accepted count.
- 5–20: 16 bidder addresses as unsigned field values.
- 21–36 and 37–52: commitment high and low halves.
- 53–56: sale boolean, winning insertion index, winning identity, price.

Every inactive slot is zero, including private witness amount and nonce. The proof
binds the rules hash while reserve and bound are separately contract-checked public
inputs. Ciphertext digests are immutable/signature-bound registry data but the proof
does not attest encryption consistency; another prover holding valid openings can
prove even if ciphertext storage is broken. That limitation matches the spec.

Invalid/unavailable openings stop proving; they cannot be dropped. After the fixed
finalization deadline, any account may expire an auction and no proof can revive it.
Seller delivery, bidder independence, funding, and Zcash payment are not proven.

Sources: [official compatibility map](https://github.com/AztecProtocol/aztec-packages/blob/next/barretenberg/bbup/bb-versions.json),
[Solidity verification guide](https://barretenberg.aztec.network/docs/how_to_guides/how-to-solidity-verifier/).
