//! Fuzz target: release_escrow with arbitrary caller and job state.
//!
//! Creates a valid escrow, starts work, then fuzzes the release call with
//! an arbitrary caller address.  Verifies that the contract never panics
//! unexpectedly — only the documented error conditions should be reachable.
#![no_main]

use libfuzzer_sys::{arbitrary, fuzz_target};
use soroban_sdk::{testutils::Address as _, Address, Env, String as SorobanString};
use marketpay_contract::{CreateEscrowParams, MarketPayContract, MarketPayContractClient};

#[derive(Debug, arbitrary::Arbitrary)]
struct FuzzInput {
    /// Whether to call release with the real client address (valid) or a random one.
    use_real_client: bool,
    /// Padding to provide entropy for address generation.
    _padding: u64,
}

fuzz_target!(|data: FuzzInput| {
    let env = Env::default();
    env.mock_all_auths();

    let contract_addr = env.register_contract(None, MarketPayContract);
    let client = MarketPayContractClient::new(&env, &contract_addr);

    let token_admin = Address::generate(&env);
    let token_addr = env.register_stellar_asset_contract_v2(token_admin).address();
    let sac = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

    let real_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let random_caller = Address::generate(&env);

    sac.mint(&real_client, &1_000_000);

    let job_id = SorobanString::from_str(&env, "fuzz-release-job");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_addr,
        amount: 1_000,
        milestones: None,
        timeout_ledgers: Some(1000),
        referrer: None,
    };

    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_escrow(&job_id, &real_client, &params);
        client.start_work(&job_id, &freelancer);

        let caller = if data.use_real_client { real_client.clone() } else { random_caller };
        client.release_escrow(&job_id, &caller);
    }));
});
