# Public deployment

Updated October 6, 2026. The web app is published at
[sealed-auctions.vercel.app](https://sealed-auctions.vercel.app).
The hosted app is connected to the deployed Base Sepolia registry and Supabase.
The public testnet MVP is verified end to end: three hosted encrypted bids, a
finalized real winner proof, winner-only invoice claiming, and the exact shielded
invoice payment confirmed by the viewing-only receiver.

## Provisioned

- Vercel project: `sealed-auctions`, scope `vincents-projects-2bbb9bb8`.
- Project ID: `prj_of7EUi266MIYts8lgb47u5L9FulO`.
- Initial deployment: `dpl_6sg8yXnZx2xbM6Co9w9UTaKPVnqV`.
- Readiness-fix deployment: `dpl_akw1NPYDVugsMEueyjtK2YQDfTU3`.
- Supabase-connected deployment: `dpl_4AZ9YCJuMbx6k3YfGsmSdeatTzXD`.
- Base-connected deployment: `dpl_5L4vc5V4h4PCsqrkr7vav3TU5MPb`.
- Public-manifest deployment: `dpl_2RrRRu8YM6Fr7Y8dvqPn4vmx173J`.
- Next.js preset; Node 24. Build and TypeScript passed on Vercel.
- TLS and HTTP 200 verified for `/`, `/create`, `/verify`, `/api/config`,
  and `/api/auctions`. Config reports `ready: true`, `paymentReady: true` after the receiver integration.
  After the Supabase deployment, the authenticated hosted database health check
  returns connected/schema-ready/RLS-enabled, and the unauthenticated check is
  rejected with HTTP 401. Registry and verifier addresses are configured.

The upload dry run excluded environment files, local databases, private keys,
native tool binaries, private proof witnesses, local evidence and runtime state.
The initial deployment received no application credentials. Linking the project
adds `.vercel/` to `.gitignore` and may add a Vercel OIDC token to ignored `.env.local`.

## Base Sepolia contracts

The user funded the dedicated deployer with 0.1 test ETH. The four deployment
receipts and runtime hashes were checked, as was the registry's immutable verifier.
The separate relay received 0.02 test ETH; its balance was independently checked.

- Registry: `0x61eaDB5e2609fdf05212a3921F7f847fa37C8cd2`.
- Verifier: `0x1C3Fb7aC0b4Eb0838e06934145080c78F9bEe051`.
- Relay: `0x4F2d55D3E49060DCaAb83dbAcA05606e7Ba36068`.
- Public deployment manifest: `public/deployments/base-sepolia.json`, served at
  `/deployments/base-sepolia.json`; local source `.data/base-sepolia-deployment.json`.
- Private resumable journal: `.data/base-sepolia-deployment.journal.json`.

The public RPC briefly exposed receipts before numbered blocks. Resuming the
same journal completed all four contracts without duplicate deployments. The
script now retries missing canonical blocks up to six times and still rejects
hash mismatches. Do not delete the journal to bypass a recovery error.

A clearly labeled, non-commercial demo auction (ID `1`) was created through the
hosted API. Its creation transaction is
`0x9681acf155c787de5e9bdc6ec0d2c0b44c7acbea334453d86742a45575d1c15b`.
It closes at `2026-10-06T19:14:45Z` and was pending finalized visibility when
created. No payment was attempted.

The app intentionally waits for Base's `finalized` block tag before displaying
accepted auctions, bids or results. A mined transaction can therefore remain
pending for several minutes. The finalized snapshot must not be replaced with
`latest` to make a demo appear faster.

## Managed PostgreSQL — Supabase

Supabase is the selected provider. The earlier Neon attempt created no database;
Neon terms acceptance is no longer required for this plan.

Use a dedicated Supabase project for Sealed. In the dashboard, open **Connect**
and copy the **Session pooler** connection string (port **5432**). Set it privately
as `DATABASE_URL` in `.env.production.local` and the worker's testnet environment.
Copy the actual host and username from the dashboard; do not guess the pooler host.
Percent-encode special characters in the password and use verified TLS settings
from the dashboard (for example `sslmode=verify-full`). Do not disable certificate
validation. Direct connections also work when the host has IPv6 connectivity.

**Do not use transaction pooling on port 6543.** The web relay and worker use
session-level PostgreSQL advisory locks. Supabase's general serverless recommendation
for transaction pooling does not fit this application's current locking design.
The application and environment uploader reject known Supabase transaction endpoints.

Set `DATABASE_POOL_MAX=2` on Vercel and initially on the worker. This limits connections
per process while allowing nested database operations; setting one connection would
stall nested operations. Monitor total connections as web instances scale.

Apply both migrations with the chosen environment explicitly:

```sh
npx tsx --env-file=.env.production.local scripts/db-migrate.ts
```

`001-init.sql` creates the application schema; `002-server-only.sql` enables RLS and
revokes public/anon/authenticated access to our tables. No browser Data API policies
are added. The trusted database owner/server role keeps access through `pg` behind
the existing application authorization. No Supabase JavaScript SDK, anon key, or
service-role key is required. Never expose `DATABASE_URL` through `NEXT_PUBLIC_*`.

Provisioned October 6, 2026:

- Project: `sealed-auctions`, reference `jzgcoczdqwqithtkoucy`.
- Organization: `makluganteng's Org`, existing Free plan, Nano compute.
- Region: `ap-southeast-1` (Singapore).
- Session pooler: port 5432, verified TLS using Supabase's dashboard CA certificate.
- All nine application tables migrated; RLS enabled and anon/authenticated SELECT
  privileges denied, verified against the actual remote database.
- Connection stored only in ignored `.env.production.local`,
  `.env.worker.testnet.local`, and Vercel production secret variables.
- Database password is in an owner-only ignored file; it was not printed or added
  to source control. No existing Supabase projects were changed.

`DATABASE_SSL_CA` contains the PEM certificate downloaded from Supabase's Database
Settings. The server passes it to node-postgres with certificate/hostname checking
on. It removes URL `sslmode` only when using this explicit verified TLS object,
because node-postgres otherwise replaces the CA configuration. The public CA is
not a private key. Keep preview/development databases separate.

Sources: [connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres),
[row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Web environment

Use a dedicated ignored environment file for public testnet configuration.
Set `APP_ORIGIN=https://sealed-auctions.vercel.app` and `BASE_CHAIN_ID=84532`.
Populate registry/verifier addresses from the verified Base Sepolia deployment.
Use dedicated relay and invoice signer keys, operator token, and evaluator public
key. The private evaluator key belongs only on the worker.

The allowlisted synchronization helper defaults to a dry run and prints keys only:

```sh
node scripts/deployment-vercel-env.mjs .env.production.local
node scripts/deployment-vercel-env.mjs .env.production.local --apply
vercel deploy --prod
```

The helper uploads values through stdin as Vercel secret variables. It never
uploads evaluator private keys, deployer keys, Zcash wallet seeds, RPC credentials,
or arbitrary variables. `VERCEL_CLI_PATH` can point to an already-installed
Vercel CLI JavaScript entry point if `vercel` is not on PATH. Inspect `vercel deploy
--dry --json` before each upload when new local artifacts have been generated.

The web app reads `paymentReady` from a successful worker scan recorded in the
database within the last 90 seconds, matching the configured seller destination.
Missing, stale or failed health reports disable payment actions. The worker checks
the node's testnet identity and queries the configured wallet account even when
there are no invoices. Wallet RPC URLs and credentials stay only on the worker;
do not expose wallet RPC publicly or copy loopback URLs into Vercel.

## Persistent worker

Vercel hosts the UI and request API. The continuous worker requires a separate
process with Node, Python, the pinned Noir/Barretenberg binaries, database access,
Base Sepolia RPC, evaluator private key, and viewing-only receiver integration.
Run a single replica initially. Build proof tools for the host architecture; do
not upload the locally built macOS binaries to a Linux host.

An existing awake computer can run the worker without adding a cloud subscription:

```sh
node --import tsx --env-file=.env.worker.testnet.local scripts/worker.ts
```

It must use the managed database and the same public testnet registry as Vercel.
This is suitable for an attended demo, not an always-available service. Protect
`.env.worker.testnet.local` and the key file with owner-only permissions, retain secure
backups, and keep the receiver state durable.

An attended worker is running locally against Supabase and the public registry.
Its PID and private operational log are under `.data/testnet/`. Its first scan
succeeded with payment readiness false. The machine must remain awake for it to
continue.

Authenticated Porter access exists, but no cloud worker was deployed. Its existing
clusters belong to another application; neither was changed. A candidate worker
allocation is one replica, 0.5–1 vCPU, and 1 GiB RAM, pending full Linux benchmarking.
The local proof process alone peaked around 350 MiB; total worker memory is higher.
[Porter pricing](https://www.porter.run/pricing) is $13/vCPU/month plus $6/GB RAM/month,
excluding underlying cloud costs. Therefore 0.5 vCPU/1 GB starts at $12.50/month
in Porter fees plus cloud costs, and needs a host/cost decision before provisioning.

## Remaining completion checks

1. Supabase project, migrations, verified TLS and hosted operator health: complete.
2. Base Sepolia registry, verifier and funded relay: complete; runtime hashes checked.
3. Matching web/worker environments and hosted configuration health: complete.
4. Attended local worker: running; an always-available cloud host remains unconfigured.
5. Dedicated Zcash testnet receiver and supported viewing-only scanner: complete,
   including a real shielded probe and SDK-backed legacy/R2 address matching.
6. Hosted bidding, independent proof verification, winner-only claim, and actual
   shielded invoice settlement: complete for auction `2`.

## Compatible devtool receiver backend

`ZCASH_SCANNER_BACKEND=devtool` selects the dedicated viewing-only wallet exporter.
Set `ZCASH_WALLET_BINARY`, `ZCASH_VIEW_WALLET_PATH`,
`ZCASH_ADDRESS_VERIFIER_BINARY`, and `ZCASH_ACCOUNT_UUID` only
in the worker environment. No wallet paths, keys, process commands, or scanner
RPC credentials belong in Vercel. The default backend remains `zallet`.

The worker invokes the fixed repository exporter with argument-separated
`execFile`, a restricted environment, a time limit, and a bounded output size.
The exporter checks the real testnet network, viewing-only account, completed
scan, and exact received outputs. The application requires a fresh snapshot and
the exact committed seller address among the wallet's external shielded addresses.
An official-SDK helper checks ownership through the external incoming viewing key
and compares actual receiver values. Legacy-to-R2 matches are restricted to their
specific shielded pool; an Orchard match never authorizes a Sapling recipient.
It does not infer equivalence from address prefixes or shared wallet ownership.
Missing files, failed sync, stale data, or invalid recipient binding revoke payment
readiness. Unit fixtures do not count as a completed live shielded-payment test.

## Attended runtime and storage

The verified native wallet and receiver verifier are stored durably in
`.tools/zcash-nu7/`. Restored sender/seller wallets and the isolated UFVK-only
scanner are under `.data/zcash-nu7/wallets/`, with owner-only directory/file
permissions. Original recovery material under `.data/zcash-zingo` remains
unchanged. `.data/zcash-nu7-runtime.json` records paths and checksums privately.

A temporary RAM volume was used during a disk-space shortage. Once space became
available, the worker was stopped; all copied files were hash-checked and wallet
SQLite databases passed integrity checks. Tools and wallet state were restored
to persistent storage, the worker restarted successfully, and the unused RAM
volume was unmounted. No active runtime path depends on it now.

The attended worker uses an explicit `TMPDIR` pointing to `.data/worker-tmp` in
its process environment. A dotenv value alone does not override an existing
macOS `TMPDIR`. Stop the prior worker gracefully before starting another one;
`.data/testnet/worker.pid` identifies this attended process. Keep this Mac awake
for the demo. A persistent cloud worker has not been provisioned.

## Verified public end-to-end run

On October 6, 2026 (Asia/Jakarta), [auction 2](https://sealed-auctions.vercel.app/auctions/2)
completed the real public-network path. Three independently signed, time-locked
encrypted bids were registered through the hosted API. The immutable verifier
accepted a 9,536-byte proof with 57 public inputs. The 3,000,000-zatoshi bid won
at insertion index 1. The separate observer CLI checked runtime hashes, canonical
registry inputs, and the cryptographic proof at finalized Base block `47731741`.

The losing identity received HTTP 403 when attempting to claim. The winning
identity signed a fresh challenge and received a signature-validated invoice.
The dedicated payer sent exactly **0.03 TAZ** with its exact private memo to the
committed seller destination. The UFVK-only receiver matched one Ironwood output
and the authenticated invoice API returned **receiver-confirmed**, with at least
three confirmations. No database row was manually marked paid.

Invoice tokens, memos, signing identities and private wallet material remain in
ignored owner-only local files. Detailed receipt evidence is also kept out of
Git and web uploads. Public winner proof data is available from the app.

Latest hosted build: `dpl_B7UD9xszowzVVQ65wQ9of31b4gUE`. TypeScript, ESLint,
46 application tests, 13 exporter tests, and six SDK binding tests passed. Two
opt-in application integration suites remain skipped in the default test command;
this public end-to-end run was performed separately. GitHub hosted-runner delays
affected the independent helper CI run; its local build and real receipt checks
passed. The active worker is still an attended process on this Mac.
