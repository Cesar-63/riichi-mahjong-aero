#!/bin/sh
# Rebuilds server/engine/mortal/encoder.wasm from mortal/encoder (Rust).
# Needs the wasm32-unknown-unknown target: rustup target add wasm32-unknown-unknown
set -e
cd "$(dirname "$0")"
cargo build --release -p mortal-encoder --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/mortal_encoder.wasm ../server/engine/mortal/encoder.wasm
echo "server/engine/mortal/encoder.wasm"
