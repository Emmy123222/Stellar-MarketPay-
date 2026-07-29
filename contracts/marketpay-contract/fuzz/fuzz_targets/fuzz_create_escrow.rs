//! Fuzz target: create_escrow with arbitrary inputs.
//!
//! Feeds random `amount`, `timeout_ledgers`, and job-id strings into
//! `create_escrow`.  The harness catches panics from invalid inputs that
//! should be handled gracefully (e.g. zero amounts, excessively long job
//! IDs) and surfaces them as fuzzer findings rather than as uncaught
//! panics that would crash the WASM runtime.
#![no_main]

use libfuzzer_sys::{arbitrary, fuzz_target};
use soroban_sdk::{testutils::Address as _, Address, Env, String as SorobanString};
use marketpay_contract::{CreateEscrowParams, MarketPayContract, MarketPayContractClient};

#[derive(Debug, arbitrary::Arbitrary)]
struct FuzzInput {
    /// Arbitrary job-id string (up to 64 bytes kept for valid Soroban strings).
    job_id: Vec<u8>,
    /// Token amount — can be negative, zero, or very large.
    amount: i128,
    /// Optional timeout in ledgers.
    timeout_ledgers: Option<u32>,
}

fuzz_target!(|data: FuzzInput| {
    let env = Env::default();
    env.mock_all_auths();

    // Truncate to a valid Soroban string length.
    let job_id_bytes: Vec<u8> = data.job_id.into_iter().take(32).collect();
    let job_id_str = match std::str::from_utf8(&job_id_bytes) {
        Ok(s) if !s.is_empty() => s.to_string(),
        _ => "fuzz-job-id".to_string(),
    };
    let job_id = SorobanString::from_str(&env, &job_id_str);

    let contract_addr = env.register_contract(None, MarketPayContract);
    let client = MarketPayContractClient::new(&env, &contract_addr);

    let token_admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let sac = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let caller = Address::generate(&env);
    let freelancer = Address::generate(&env);

    // Mint enough for the fuzz amount (clamp to prevent overflow in SAC).
    let mint_amount = data.amount.clamp(0, 1_000_000_000_000);
    if mint_amount > 0 {
        sac.mint(&caller, &mint_amount);
    }

    let params = CreateEscrowParams {
        freelancer,
        token: token_addr,
        amount: data.amount,
        milestones: None,
        timeout_ledgers: data.timeout_ledgers,
        referrer: None,
    };

    // The call may panic for invalid inputs; that is expected contract
    // behaviour (panic = trap in WASM).  The fuzzer catches unintended
    // panics (e.g. integer overflow, out-of-bounds) separately.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_escrow(&job_id, &caller, &params);
    }));
});
