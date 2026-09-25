# Test fixtures

`dummy_upgrade_target.wasm` is a minimal, independently-compiled Soroban
contract (a single `#[contract]` struct with one no-op function) used only
by the `upgrade_tests` module in `src/lib.rs` to exercise a *real*
`env.deployer().upload_contract_wasm()` / `upgrade()` WASM swap in unit
tests, instead of simulating the swap by hand-editing storage.

It is unrelated to marketpay-contract's own ABI — after the swap the tests
read storage directly via `env.as_contract(...)` rather than calling client
methods, since the installed wasm no longer exposes marketpay-contract's
functions.

To regenerate (e.g. after a `soroban-sdk` upgrade, if the host rejects the
stored blob because its embedded env-interface metadata is out of date),
build a scratch crate with a `Cargo.toml` pinning the same `soroban-sdk`
version as `contracts/marketpay-contract/Cargo.toml`, e.g.:

```toml
[package]
name = "dummy-upgrade-target"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = "=27.0.6"
```

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct DummyUpgradeTarget;

#[contractimpl]
impl DummyUpgradeTarget {
    pub fn ping(_env: Env) -> u32 {
        1
    }
}
```

then `cargo build --target wasm32v1-none --release` and copy
`target/wasm32v1-none/release/dummy_upgrade_target.wasm` over this file.
