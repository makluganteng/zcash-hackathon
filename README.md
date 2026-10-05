# Sealed

Private first-price auctions with a verifiable winner and shielded Zcash settlement.
Next.js on Vercel hosts the interface; an immutable EVM registry records bids and
verifies a real Noir proof; a separate worker opens bids and monitors the receiver.

**Public testnet app: [sealed-auctions.vercel.app](https://sealed-auctions.vercel.app).** Supabase and the deployed Base Sepolia registry/verifier are connected. The hosted flow is verified end to end: [auction 2](https://sealed-auctions.vercel.app/auctions/2) registered three encrypted bids, finalized a real winner proof, rejected a losing claimant, issued the winner’s signed invoice, and confirmed its exact 0.03 TAZ shielded payment through the viewing-only receiver. The app never substitutes a mock proof or payment confirmation when an integration is missing. It has not been audited. See [deployment status](docs/deployment.md) and [Zcash testnet compatibility](docs/zcash-testnet.md).

## What works

- Browser-local bidder identities, backup/restore, EIP-712 authorization.
- drand time-lock encryption around evaluator-only encryption; losing bids remain
  hidden from the public after opening. Live beacon tests ran in Node and Chromium.
- A 16-bid, first-price Noir circuit and generated Solidity verifier. The registry
  supplies every accepted commitment and the rules; the operator cannot pick a
  subset or override the result. Earliest insertion breaks equal-highest ties.
- Durable PostgreSQL bid storage and transaction recovery; worker proof generation;
  winner-only claims, replay protection, signed invoices, and chain reorg checks.
- Receiver adapters for Zallet RPC and a compatible devtool viewing-only wallet,
  matching exact notes by account, address, integer amount and memo. Missing or
  stale scanner configuration keeps payment controls disabled.
- Responsive auction floor, creation, bidding, receipts, claims and proof inspection.

## Run the web app

Requires Node 22+, npm, PostgreSQL 17, Python 3, and Foundry for contract development.

```sh
npm ci
cp .env.example .env.local
npm run keys:generate -- .data/keys
# PostgreSQL option (uses loopback port 55432):
docker compose up -d postgres
```

Fill `.env.local` from the example. For the Compose database, use
`postgresql://auction_dev:local-development-only@127.0.0.1:55432/sealed_auctions`.
Set `EVALUATOR_PUBLIC_JWK` to the one-line contents of the generated public JWK,
not the private JWK. Generate separate testnet relay and invoice signing keys and
an operator token. Keep all credentials in ignored local files/environment storage.

```sh
npm run db:migrate
npm run dev
```

Open [localhost:3000](http://localhost:3000). Without integrations, the app shows an
honest setup/empty state. Seller creation requires the operator token and a dedicated
shielded **testnet** destination in `SELLER_ZCASH_ADDRESS`. It cannot silently change
once an auction opens. The deadline uses chain time; UI countdowns are advisory.

## Local chain and real proof

```sh
npm run proof:setup
npm run proof:build
# Separate terminal; interval mining lets finalized-tag reads advance:
anvil --host 127.0.0.1 --chain-id 31337 --block-time 1
npm run chain:deploy:local
```

Set `BASE_CHAIN_ID=31337`, `BASE_RPC_URL=http://127.0.0.1:8545`,
`REGISTRY_ADDRESS` and `EXPECTED_VERIFIER_ADDRESS` from `.data/local-deployment.json`.
Use an Anvil test account as the relay **only for this local chain**. The local
network is allowed only in development; the production app permits Base Sepolia.
Anvil's finalized tag lags 64 blocks, so initial deployment/registrations can be
pending for roughly a minute. Don't confuse pending with accepted.

For a non-payable browser integration fixture, after configuring DB, keys and relay:

```sh
npm run auction:local -- 600
```

This creates a real local auction with a deliberately unusable destination
commitment. Its description says no item is for sale and payments are disabled.
It exercises actual encryption, registration and proof generation, not real ZEC.
It cannot be used on a public chain. No synthetic auction rows load by default.

Worker configuration is separate from the web environment:

```sh
cp .env.local .env.worker.local
# In .env.worker.local only, configure the generated private-key file path:
# EVALUATOR_PRIVATE_JWK_PATH=.data/keys/evaluator-private.jwk.json
npm run worker
```

The worker needs the task-local proof binaries, durable database access and the
private evaluator key. It waits for the drand round and confirmed chain state;
unknown or malformed registered bids block it rather than being skipped.

## Verify independently

```sh
npm run verify -- reviewed-deployment.json proof-bundle.json AUCTION_ID
```

Get a proof bundle from `/api/auctions/AUCTION_ID/proof`. Use an independently reviewed
deployment manifest; do not trust a manifest supplied by an arbitrary auction
publisher. `VERIFY_RPC_URL` can override the manifest's RPC. The command checks
network, runtime code hashes, immutable verifier, canonical auction result and all
public inputs, then calls the real verifier. [Proof details](contracts/README.md).

## Deploy and connect testnets

1. Generate proof artifacts and deploy contracts using an explicitly funded Base
   Sepolia key: `npm run chain:deploy:base` with `BASE_RPC_URL` and
   `DEPLOYER_PRIVATE_KEY` set privately. The script refuses other chains and never
   uses an Anvil key as fallback. No public deployment was performed in this build.
2. Import the repository into Vercel, use the Next.js preset, and configure the
   web variables from `.env.example`, including the exact HTTPS `APP_ORIGIN`.
   Use chain 84532 and set registry/verifier addresses from the deployment manifest.
3. Use a dedicated Supabase project with its **Session pooler (5432)** connection.
   Set `DATABASE_URL` privately and run both migrations as described in
   [deployment setup](docs/deployment.md). Transaction pooling (6543) is incompatible
   with the application’s session locks; the migrations restrict Data API access.
4. Run the worker separately on a persistent host with compatible proof binaries,
   evaluator private-key file, and durable receiver state. Keep deployments and
   preview databases, wallets and keys isolated. Do not put private keys in
   `NEXT_PUBLIC_*`, client bundles, or a web deployment's checked-in files.
5. Create/import a dedicated Zcash testnet receiving wallet. Give the scanner only
   its supported viewing access, then configure `SELLER_ZCASH_ADDRESS`,
   `ZALLET_RPC_URL`, `ZALLET_ACCOUNT_UUID`, and `ZCASH_NODE_RPC_URL` plus private
   RPC authorization where required. The node must report the test network.
   Alternatively, set `ZCASH_SCANNER_BACKEND=devtool`, `ZCASH_WALLET_BINARY`,
   `ZCASH_VIEW_WALLET_PATH`, `ZCASH_ADDRESS_VERIFIER_BINARY`, and
   `ZCASH_ACCOUNT_UUID` on the worker only. The
   compatible executable must be checksum-verified, and the wallet must contain
   exactly one imported viewing-only testnet account with the exact seller address.
6. Send a genuine shielded testnet payment with the exact invoice amount and memo
   and verify receipt before describing the Zcash integration as end-to-end tested.

The Zallet scanner uses `z_listtransactions`, `z_viewtransaction`, and
`z_listunifiedreceivers`. The devtool backend runs the fixed Python exporter,
which synchronizes through the official wallet library, then reads exact received
outputs from one read-only SQLite snapshot. It preserves spent notes and rejects
spending wallets. Freshness, complete scanning, account identity, destination
ownership, and unique output IDs are checked before reconciliation. The SDK helper
checks external viewing-key ownership and typed receiver equality to bind legacy
and NU7 R2 addresses separately for each shielded pool. Different Unified Addresses
are never treated as interchangeable merely because one wallet owns both. Unexpected schemas, unavailable
providers, wrong networks, or unknown notes fail closed. Late/partial/excess
payments require review.
Native proof binaries have been exercised on macOS ARM64; validate the worker's
chosen production host separately. Vercel does not run the continuous worker.

## Tests and evidence

```sh
npm run lint
npm run typecheck
npm test
npm run test:proof
npm run test:contracts
npm run test:chain
npm run test:crypto:live
# Requires local Postgres and Anvil; creates its own test DB/chain:
RUN_SERVER_INTEGRATION=1 npx tsx --test tests/server/integration.test.ts
# Requires Python Playwright/Chromium and an OPEN LOCAL auction:
python3 scripts/browser-smoke.py AUCTION_ID
```

`test:chain` runs a self-contained local registry + real proof fixture; it uses
synthetic ciphertext digests and is not the browser or Zcash payment test. The
browser smoke actually encrypts and registers three bids from separate browser
contexts. Its private identity backups stay under ignored `.data/browser-tests`.
Payment unit tests use explicitly synthetic fixtures for both scanner backends;
they are not live receipts. NU7 build CI also runs an actual unfunded testnet
wallet sync and viewing-only export. A funded payment test is tracked separately
in the deployment evidence.
Measured proof/contract sizes and resource use are in [contracts/README.md](contracts/README.md).

## Boundaries

- The evaluator learns bids after opening. Base publishes pseudonymous participation
  and timing. No claim of full anonymity, hidden participation, or private computation
  from the evaluator is made.
- The proof establishes the correct winner among contract-recorded bids. It does
  not prove independent humans, funded bids, seller honesty, payment, or delivery.
- No escrow, ZEC bridge, automatic refunds or automatic runner-up promotion.
- Ciphertext correctness is not proved at admission. Malformed or unavailable bids
  can stall an auction. Key backups are unencrypted local secrets; browser origin
  security and backup handling matter.
- Receiver-observed payment confirmation is separate from the verified auction result.
- The repository has not received a cryptographic/security audit. Testnet only.

[Product specification](.omx/plans/prd-private-auction-mvp.md) ·
[Acceptance specification](.omx/plans/test-spec-private-auction-mvp.md)
