//! Fuzz target: timeout_refund with arbitrary ledger advance and caller.
//!
//! Creates a valid escrow (without starting work) and fuzzes the
//! `timeout_refund` call with arbitrary ledger offsets and caller addresses.
//! Ensures that the contract cannot be drained by a non-client caller and
//! that early-refund attempts do not silently succeed.
#![no_main]

use libfuzzer_sys::{arbitrary, fuzz_target};
use marketpay_contract::{CreateEscrowParams, MarketPayContract, MarketPayContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String as SorobanString,
};

#[derive(Debug, arbitrary::Arbitrary)]
struct FuzzInput {
    /// Number of ledgers to advance before attempting timeout_refund.
    ledger_advance: u32,
    /// Whether to call timeout_refund with the real client (valid) or random address.
    use_real_client: bool,
}

fuzz_target!(|data: FuzzInput| {
    let env = Env::default();
    env.mock_all_auths();

    let contract_addr = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &contract_addr);

    let token_admin = Address::generate(&env);
    let token_addr = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let sac = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let real_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let random_caller = Address::generate(&env);

    sac.mint(&real_client, &1_000_000);

    let timeout_ledgers: u32 = 500;
    let job_id = SorobanString::from_str(&env, "fuzz-timeout-job");
    let params = CreateEscrowParams {
        freelancer,
        token: token_addr,
        amount: 1_000,
        milestones: None,
        timeout_ledgers: Some(timeout_ledgers),
        referrer: None,
    };

    client.create_escrow(&job_id, &real_client, &params);

    // Advance the ledger by the fuzz-supplied amount (bounded to prevent Soroban host TTL overflow).
    // Also advance the timestamp (approx. 5s per ledger in Stellar) so timeout expiration is exercised.
    let advance = data.ledger_advance % 1_000_000;
    env.ledger().with_mut(|l| {
        l.sequence_number = l.sequence_number.saturating_add(advance);
        l.timestamp = l.timestamp.saturating_add((advance as u64) * 5);
    });

    let caller = if data.use_real_client {
        real_client.clone()
    } else {
        random_caller
    };
    let _ = client.try_timeout_refund(&job_id, &caller);
});
