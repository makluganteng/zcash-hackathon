# Private Auctions — Product Specification

Version: 0.2 · Updated: 2026-10-05 · Stage: specification, not implemented
Primary track: Private Markets
Companion: [Acceptance specification](test-spec-private-auction-mvp.md)

## 1. Product

A web application for sealed-bid auctions with publicly verifiable winner selection
and shielded ZEC payments. Sellers fix the auction rules, bidders submit encrypted
bids, and a zero-knowledge proof establishes the result without publishing losing
amounts. Anyone can verify that the result covers every contract-recorded bid.

Example: a designer auctions one digital commission. Three people bid privately.
The result publishes a verified winning price and a pseudonymous winner. The
winner pays the designer directly using shielded Zcash testnet funds.

**Promise: Verify the winning bid. Keep losing amounts private from the public.
Pay the seller in shielded ZEC.**

This replaces the earlier server-authoritative MVP plan. Next.js/Vercel remains
the web stack. Base Sepolia becomes authoritative for accepted bids and verified
results. Ztarknet and ZEC bridging are not dependencies.

## 2. Users and scope

| User | Job | Successful outcome |
| --- | --- | --- |
| Seller | Auction one item/service | Verified result and observed payment |
| Bidder | Submit a sealed bid and check fairness | Contract inclusion and independently verifiable result |
| Winner | Claim and pay | Ownership checked; correct invoice paid |
| Observer/judge | Check the result | Independently verify proof and registry |
| Operator | Keep services available | Recover failures without fabricating results |

MVP defaults:

- Base Sepolia for auction evidence; Zcash testnet for payments. No real funds.
- One preconfigured demo seller; multiple sequential auctions.
- One off-chain item/service per auction; manual delivery.
- First-price: highest eligible bid wins and pays its own bid.
- Maximum 16 accepted bids; one bid per auction-specific application identity.
- Public reserve, amount bounds, closing time, and fixed rules.
- Equal highest bids use the earliest contract insertion index.
- No bid edits, withdrawals, or seller cancellation after opening.
- Default finalization window: 24 hours after bidding closes.
- Default payment window: one hour after the finalized result's block timestamp.
  Windows are fixed at opening; short test fixtures may use different values.
- Browser encryption: evaluator public-key encryption wrapped in drand time-lock
  encryption, with a pinned unlock round after the submission deadline.
- Public result: winning amount and pseudonymous commitment/identity.
- Manual review for nonpayment or problematic payments; no automatic runner-up.

## 3. Guarantees and limits

**G1 — Correct winner:** under the fixed circuit/verifier and chain assumptions,
a verified result covers all active registered commitments and applies the fixed
reserve, highest-bid selection, and tie-break. No operator/admin can override it.

**G2 — Independent participation record:** accepted means registered in the
contract before its chain-time deadline and confirmed under the documented chain
policy. API acknowledgement alone means pending. The proof binds the exact frozen
ordered bid set and count, not a list chosen by our server.

**G3 — Limited confidentiality:** before unlock, honest encrypted submissions hide
amounts under the encryption/drand assumptions. After opening, the evaluator and
prover learn the bids; losing amounts stay private from public observers. A ZK
proof does not hide inputs from the party generating it.

Base exposes commitments, pseudonymous bidder identifiers, submitter addresses,
counts, timing, and ordering. Winner output is linkable to its registered bid.
The server/relay may observe IP addresses and other metadata. Do not promise
anonymity, hidden participation, or confidentiality from the evaluator.

**G4 — Direct shielded payment:** ZEC moves from winner to seller on Zcash, without
passing through Base or a bridge. The platform holds no ZEC spending authority.
Payment confirmation comes from the receiver scanner, not the Base auction proof.

Non-guarantees: independent human bidders, anti-shill/anti-Sybil protection, funded
bids, payment enforcement, delivery, censorship resistance, or operator uptime.
One person can create multiple identities. Circuit correctness, verifier integrity,
cryptography, data availability, and chain operation remain dependencies.

## 4. User journey and screens

1. **Create:** seller enters item, reserve, close time, and windows; reviews and
   opens immutable rules on Base. Corrections require a new auction.
2. **Auction page:** item, seller, reserve, estimated countdown, capacity, testnet
   labels, privacy summary, and bid action. Never show a running highest amount.
3. **Bid:** create/restore a fresh local identity; export a recovery backup; enter
   amount; review, encrypt, and submit. Show uploading, pending registration,
   confirmed acceptance, and rejection as distinct states.
4. **Receipt:** contract/auction, commitment, ciphertext digest, insertion index,
   transaction, confirmation state, and downloadable signed envelope. No public
   plaintext amount or salt. Bidder can independently check contract inclusion.
5. **Results:** closing, waiting to open, proving, awaiting verification, verified
   sale, verified no-sale, or expired without result. Publish price only after
   verification. Include proof download and independent verification instructions.
6. **Claim:** authenticate with the identity bound to the winning bid and obtain
   the private invoice. Other bidders can inspect their own status.
7. **Pay:** check invoice against verified result/destination commitment; show
   shielded address, exact amount, memo reference, QR/link, expiry, and status.
8. **Seller view:** track auction and receiver-observed payment status. Normal
   seller APIs expose no losing amounts, though a seller operating the evaluator
   could read them; this is the G3 boundary.

No email/social login, profiles, embedded Zcash wallet, or activity analytics are
needed. Identity loss may prevent claiming; backup and restore are required.

## 5. Rules, identity, and bid registry

The opening transaction fixes the auction/domain, seller, item-description hash,
reserve, integer amount bounds, capacity, close time, tie-break, finalization and
payment windows, evaluator public key, drand chain/round, seller's Zcash testnet
destination commitment, and proof verifier/version. Hash the canonical rules.
No upgrade/admin path may mutate an open auction or bypass verification.

A fresh local signing key identifies each bidder for one auction. The signed
envelope binds auction/domain, rules hash, bidder identity, bid commitment, and
ciphertext digest. The commitment binds the same auction/rules/identity to the
amount and a fresh 32-byte random salt. Use canonical encodings, domain separation,
integer zatoshis, and bounded comparisons, never floating point or field wraparound.

The contract verifies authorization, domain, rules binding, duplicate identity,
capacity, and deadline. It stores an ordered leaf with commitment, identity, and
ciphertext digest. Anyone may relay a correctly signed envelope; the sponsored
demo relay is a convenience, not an operator-only admission gate.

Durably store encrypted blobs before relay submission; clients retain a copy and
can resupply the identical bytes by digest. Bound upload sizes. No bid plaintext
or private keys pass through the web API/server rendering. The database indexes
contract state but cannot override it. Admission ordering comes from the contract.

There is no encryption-consistency proof at admission in this first MVP. A valid
signature/commitment does not establish that its ciphertext opens correctly.
The supplied evaluator stops on unreadable/mismatched ciphertext and reports a
blocked job; it never silently discards that registered bid. The on-chain guarantee
is narrower: a proof requires valid commitment openings for every active bid, not
proof of how those openings were obtained. Another prover with the complete valid
openings can finalize even if a stored ciphertext is broken. Ciphertext/opening
consistency and correct use of the claimed time lock are not proven by this circuit.
Out-of-range commitment openings cannot yield a valid result; valid below-reserve
bids are processed normally. Malicious participants can stall auctions or fill
the 16 slots. This is an availability limitation, not a solved anti-spam problem.

## 6. Closing and proof requirements

The contract rejects registrations at/after closing and freezes the ordered set
and count. The worker uses a confirmed/finalized registry snapshot under a policy
verified during the chain spike. It does not use a browser clock or server-only
list. Disclose chain ordering, timestamp, and finality assumptions.

Use a pinned supported drand chain and verified beacon signatures. Select an
unlock round after closing with a documented clock/finality margin. Outer opening
reveals only inner ciphertext; the evaluator key opens the inner layer. Outages
cause delay, never an early plaintext bypass.

Public proof inputs: auction/domain, rules hash, frozen registry digest/count,
sale/no-sale outcome, winning index/commitment/identity, and winning price.
Private witness: all active bid amounts, salts, and required commitment openings.

The fixed-capacity circuit must:

- Reconstruct the complete ordered registry with every active slot exactly once.
- Bind identity/ciphertext metadata in the registry and enforce all openings,
  auction/rules bindings, and amount ranges.
- Recompute the canonical rules hash from the rule fields used in the computation
  (or expose them as contract-checked public inputs). An advertised hash alone
  cannot authorize a private reserve, bound, or tie-break chosen by the prover.
- Constrain active count and inactive padding for all 16 slots.
- Apply reserve, highest amount, and earliest-index tie-break.
- Bind winning identity, commitment, and first-price amount to the selected slot.
- Produce canonical no-sale for zero bids or all valid bids below reserve.
- Constrain every public output and prevent cross-domain/auction replay.

The contract compares proof inputs to its own frozen state, calls its fixed
Solidity verifier, and stores a result only after successful verification. Any
account can submit a valid proof; no backend/admin may assign a winner directly.

If the evaluator cannot obtain valid openings for every active bid, show a
privacy-preserving blocked job and retry. This worker status does not prevent
another prover from submitting a complete valid proof. If no such proof arrives
by the immutable finalization deadline, contract expiry is terminal: no winner,
invoice, or late proof. Missing openings cannot be skipped to manufacture a
verified no-sale. No deposits exist to refund.

Publish circuit source/version, toolchain pins, verification-key digest, verifier
and registry addresses, proof/public inputs, and registry reference. Provide an
independent verification command alongside UI verification. It must check the
canonical contract state and expected verifier, not just trust the proof bundle's
claimed root. A valid proof over an arbitrary server list is insufficient.

## 7. Claim, invoice, and payment

The proven winning identity signs a domain-separated fresh challenge with expiry
and replay protection. Invoice issuance is idempotent and waits for result finality.
If finality or service recovery occurs after the fixed payment deadline, show
expired/manual review instead of issuing an active payable invoice. Do not silently
extend the deadline or restart its clock at invoice retrieval.

The app-signed invoice binds chain/contract/auction, verified result/registry,
winning identity, Zcash network, shielded destination, amount, opaque reference,
and expiry. The winner independently checks destination against the opening-time
commitment and amount against the proof result. The destination cannot be silently
substituted after bidding. Store and display invoice details only to authorized users.

Use ZIP 321 where supported. The receiver scanner uses a dedicated seller account
and supported viewing access; spending keys remain in the seller wallet. Match
real received outputs/notes, destination, reference, amount, and network. Deduplicate
by transaction plus output/note identity. A submitted txid or explorer screenshot
cannot establish shielded receipt.

Statuses: awaiting payment, detected, confirming, receiver-confirmed, expired,
and needs review. Base result records contain no Zcash payment txid or memo.
Late, partial, excess, duplicate, or ambiguously timed payments require manual
review. Zcash does not reject funds sent after an application invoice expires.
Document the adapter's confirmation threshold and timing convention. No automatic
runner-up, refund, or delivery; verified winner and payment status are separate.

Base reorgs invalidate stale registry/proof/result references and suspend affected
invoices; funds already sent require manual review. Zcash reorgs reduce/revoke
payment confirmations without changing the verified winner. Recovery survives
worker restarts and never double-issues invoices or double-processes payments.

## 8. Architecture and data

| Component | Responsibility |
| --- | --- |
| Next.js App Router + TypeScript on Vercel | UI and short-lived authenticated Route Handlers |
| Browser | Bid identity/backup, encryption, claim signatures, verification UI |
| Base Sepolia contracts | Fixed rules, bid registry, closure, proof verification/result/expiry |
| Noir + Barretenberg | Circuit, proving, fixed Solidity verifier artifacts |
| Persistent worker | Chain indexing, delayed opening/proving, result submission, payment scanning |
| Managed PostgreSQL | Encrypted blobs, indexes, jobs, invoices, payment observations |
| Existing Zcash wallet | Winner payment and seller custody |

Keep relay transaction keys, bidder keys, evaluator secrets, and wallet viewing
material separate. The API/relay has neither bidder nor ZEC spending keys. Worker
secrets never enter NEXT_PUBLIC_* variables, browser bundles, or shared caches.
Use durable wallet scan state, idempotent jobs, leases, and status polling. Continuous
scanning/proving runs separately from Vercel request-lifetime functions.

Records: Auction, BidEnvelope, CiphertextBlob, ChainRegistration, FrozenRegistry,
ProofJob, VerifiedResult, ClaimChallenge, Invoice, PaymentObservation. Chain-derived
records track network, block hash/height, transaction, and applicable versions.
Preview deployments use isolated data and credentials. Logs contain operational
identifiers/errors, not losing amounts, salts, keys, or private invoice payloads.

## 9. Milestones and feasibility gates

1. **Winner proof:** prove three bids locally and verify through generated Solidity
   on a local EVM. Wrong winner, omitted high bid, changed amount/claimant/rules,
   and padding attacks fail. Then measure time/memory, contract size, and gas at
   16 bids. Pin compatible versions before committing to deployment budgets.
2. **Encryption/payment spikes:** independently demonstrate delayed layered
   encryption and real shielded testnet receipt with memo and viewing access.
   Verify wallet/network compatibility; no silent privacy downgrade.
3. **Public registry:** implement immutable creation, signed admission, ordered
   list/count, cap/deadline, fixed verifier, result and expiry; test on Base Sepolia.
   Record finality assumptions, deployment artifacts, and relay funding behavior.
4. **User journey:** Next.js seller setup, bid encryption/backup, inclusion receipts,
   verified results, winner claim, and independent verification.
5. **Settlement/recovery:** verified invoice, scanner, confirmations, manual review,
   authentication boundaries, restarts, and both chains' reorg handling.
6. **Hosted demo:** deploy Vercel app plus worker/database; rehearse adversarial
   proof failures and the real end-to-end payment. Publish reproducible setup.

If a gate fails, document a concrete scope revision. Do not substitute mocked
payments/proofs, server-selected registries, or weaker privacy while presenting
it as this product. Library/provider versions remain implementation decisions
until the corresponding spike verifies compatibility.

## 10. Definition of done and non-goals

Three independent browser profiles register bids and verify inclusion. A lower
winner and omitted higher bid are rejected. Losing amounts remain absent from
public data. The true winner claims, validates the invoice, and sends a real
shielded testnet payment that the scanner confirms. Demonstrate verified no-sale,
blocked/expired opening, and unpaid winner. An observer verifies independently
of the hosted UI. Acceptance checks pass with evidence of what was run.

Excluded: mainnet funds, ZEC bridge, custody/escrow, deposits, tokens/NFT issuance,
multisig, automatic refunds/delivery, arbitrary seller code, other auction types,
private computation hidden from the evaluator, anti-Sybil guarantees, and production
security claims. Base does not verify or atomically enforce the Zcash payment.

## 11. Sources

- [Noir proof verification](https://noir-lang.org/docs/getting_started_manually)
- [Solidity verifier generation](https://barretenberg.aztec.network/docs/how_to_guides/how-to-solidity-verifier/)
- [Base deployment](https://docs.base.org/learn/hardhat-deploy/deployment-vid)
- [Zcash payment requests](https://zips.z.cash/zip-0321)
- [Viewing keys](https://zips.z.cash/zip-0316)
- [Wallet RPC surface](https://zcash.github.io/zallet/rpc/index.html)
- [Time-lock client](https://github.com/drand/tlock-js)
- [Layered encryption and assumptions](https://github.com/drand/tlock)
- [Vercel execution limits](https://vercel.com/docs/functions/limitations)

These establish building blocks, not a security review or tested implementation.
