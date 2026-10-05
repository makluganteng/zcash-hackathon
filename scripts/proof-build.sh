#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
.tools/noir/nargo --version | head -1 | grep -Fx 'nargo version = 1.0.0-beta.22'
test "$(.tools/bb/bb --version)" = '5.0.0-nightly.20260522'
python3 scripts/proof-fixture.py
(cd circuits/auction && ../../.tools/noir/nargo execute && ../../.tools/noir/nargo test)
.tools/bb/bb prove -b circuits/auction/target/private_auction.json -w circuits/auction/target/private_auction.gz -o circuits/auction/target --verifier_target evm --write_vk --verify
.tools/bb/bb write_solidity_verifier -k circuits/auction/target/vk -o contracts/src/AuctionVerifier.sol
forge build --root contracts --sizes
