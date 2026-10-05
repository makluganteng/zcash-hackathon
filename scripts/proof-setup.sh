#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Official Noir/barretenberg compatibility-map pairing; task-local, no shell profile edits.
NOIR_VERSION=1.0.0-beta.22
BB_VERSION=5.0.0-nightly.20260522
case "$(uname -s)-$(uname -m)" in
 Darwin-arm64) NOIR_TARGET=aarch64-apple-darwin; BB_TARGET=arm64-darwin ;;
 Linux-x86_64) NOIR_TARGET=x86_64-unknown-linux-gnu; BB_TARGET=amd64-linux ;;
 Linux-aarch64) NOIR_TARGET=aarch64-unknown-linux-gnu; BB_TARGET=arm64-linux ;;
 *) echo "Unsupported toolchain platform" >&2; exit 1 ;;
esac
mkdir -p .tools/noir .tools/bb
curl -fLsS "https://github.com/noir-lang/noir/releases/download/v${NOIR_VERSION}/noir-${NOIR_TARGET}.tar.gz" -o .tools/noir.tar.gz
tar xzf .tools/noir.tar.gz -C .tools/noir
curl -fLsS "https://github.com/AztecProtocol/barretenberg/releases/download/v${BB_VERSION}/barretenberg-${BB_TARGET}.tar.gz" -o .tools/bb.tar.gz
tar xzf .tools/bb.tar.gz -C .tools/bb
.tools/noir/nargo --version
.tools/bb/bb --version
