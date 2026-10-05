# Private Auctions — Acceptance Specification

Version: 0.2 · Updated: 2026-10-05
Status: planned checks, not executed application tests.
Companion: [Product specification](prd-private-auction-mvp.md).

## A. Rules and registry (G1, G2)

- A01: Rules, destination commitment, verifier/version, evaluator key, drand round,
  and domains are fixed at opening. No seller/admin override exists.
- A02: Valid signed envelopes register once per identity; wrong signature/domain,
  rules and duplicates fail. Any caller can relay a valid envelope.
- A03: Upload acknowledgements stay pending until confirmed registration. Receipts
  identify contract, auction, leaf, insertion index, and transaction.
- A04: Counts 0 through 16 work; a 17th fails. Concurrent submissions cannot overrun
  capacity or duplicate insertion indices.
- A05: Contract time rejects at/after closing despite stopped worker or wrong
  browser clock. Frozen ordered digest/count includes every accepted leaf.
- A06: Substituted registry/count/ordering/metadata is rejected at finalization.
  Proof checks fixed verifier and frozen state; admin cannot directly assign winner.
- A07: Finalization expiry is terminal and rejects late proofs. Retried jobs cannot
  produce conflicting results or extra invoices.

## B. Circuit and verifier (G1)

- B01: Bids [2, 5, 3] ZEC select the second identity at 5 ZEC. Counts 0, 1, 15,
  and 16 have correctly constrained active slots and padding.
- B02: Wrong winner, price, winning index, commitment, or claimant fails.
- B03: Omit/duplicate/reorder an active bid, alter count, or hide a bid as padding:
  verification fails. Every active leaf appears exactly once.
- B04: Alter amount, salt, opening, rules, reserve, domain, or registry digest:
  verification fails. A correct advertised rules hash with dishonest private
  reserve/bounds/tie-break fields also fails. Cross-domain/auction replay fails.
- B05: Highest equal bids select earliest insertion index. Reserve equality
  qualifies. Valid below-reserve bids are included but cannot win.
- B06: Empty/all-below-reserve sets produce canonical verified no-sale. Invalid
  openings cannot be skipped or reclassified as below-reserve/no-sale.
- B07: Negative/overflow/out-of-range amounts fail; field wraparound and padding
  cannot manipulate comparisons or leave public outputs unconstrained.
- B08: Altered proof/wrong key fails. Local and Solidity verifiers agree on fixtures
  with pinned tool versions. No conflicting second result can finalize. Complete
  valid openings recovered independently remain provable; ciphertext decryption
  correctness is explicitly outside this circuit's statement.
- B09: Independent verification checks canonical registry and expected verifier,
  rather than trusting bundled root or hosted UI result text.
- B10: Measure 16-bid proof time/memory, deployment size, and verification gas on
  the selected target; record actual results against hosting/chain limits.

## C. Privacy and availability (G3)

- C01: Honest ciphertext stays sealed before pinned drand round. After outer
  opening, evaluator key is still needed. Verify chain and beacon signatures.
- C02: Envelope signature binds ciphertext digest and auction/identity context.
  Tampering fails; uploads are size-bounded; clients can resupply identical blobs.
- C03: Public API/rendering/logs/receipts contain no losing amounts, salts, private
  keys, or invoices. Locally entered bid data stays client-side until encrypted.
- C04: Disclose public Base metadata and winning pseudonym. Normal seller APIs
  do not expose losing amounts; evaluator visibility is documented.
- C05: The supplied evaluator stops/retries on missing, unreadable, or mismatched
  ciphertext; it never silently skips an active commitment. Without a complete
  valid set of openings no result can verify. A different prover with complete
  valid openings may finalize; otherwise expire with no winner/invoice.
- C06: Beacon/storage/prover outages cause delay/expiry, not early opening or a
  fake result. Fresh-identity spam, shill bids and capacity DoS remain documented.

## D. Claim and settlement (G4)

- D01: Three browser profiles have separate keys; backup/restore retains claim
  ability. No bidder private key reaches the server.
- D02: Only proven winner claims; wrong key, expired/replayed challenge, or
  another auction's challenge fails.
- D03: Issue one invoice after result finality; bind root/result, claimant,
  destination, amount, reference, network, and expiry. If already past the fixed
  payment deadline, show expired/manual review without an active invoice or extension.
- D04: Winner-side checks reject altered destination/amount/network/stale result.
  No invoice for no-sale, blocked, or expired auctions.
- D05: Receive and confirm an actual shielded testnet payment with memo. A claimed
  txid or public explorer alone cannot establish payment.
- D06: Wrong destination/reference/network/amount never produces normal paid
  status; late/partial/excess/duplicate/ambiguous payments need manual review.
- D07: Deduplicate by transaction plus note/output identity across restarts;
  distinct notes in one transaction are not conflated.
- D08: Zcash reorg reverses confirmation without changing winner. Base reorg
  invalidates stale result/invoices; funds already sent require review.
- D09: Scanner has viewing access, no spending authority. Base result contains
  no payment txid/memo. UI distinguishes verified result from receiver-observed
  payment. No automatic runner-up, refund, or item delivery.

## E. Deployment and demo

- E01: Next.js production build/hosted routes work on Vercel. Private responses
  require authorization and are excluded from shared caches.
- E02: Worker has durable state, idempotent retries, and leases. No evaluator,
  relay, or viewing secrets in browser bundles. Preview data/credentials isolated.
- E03: Run project lint/typecheck, circuit/contract tests, targeted service tests,
  and critical browser flows. Label mocked reorg fixtures versus live evidence.
- E04: Record three-bidder inclusion, early-opening rejection, valid result,
  wrong-winner/omission rejection, genuine claim, and actual shielded payment.
  Also demonstrate no-sale, opening expiry, and an unpaid winner.
- E05: Publish version/artifact pins, testnet contract addresses, independent
  verification command, measured limits, trust/privacy boundaries, and setup
  reproducible from a fresh checkout.
