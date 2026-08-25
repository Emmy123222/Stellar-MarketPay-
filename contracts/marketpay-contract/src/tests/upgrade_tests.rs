use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String};

/// Verifies that:
///   - get_version() returns 1 after initialize()
///   - upgrade() with a valid hash increments the version to 2
///   - existing escrow state is preserved after upgrade
///
/// Note: `update_current_contract_wasm` requires the hash to reference
/// an installed WASM blob. In unit tests we verify the auth guard and
/// version-bump logic; the actual WASM swap is covered by integration /
/// testnet tests (see README upgrade process).
#[test]
fn test_version_starts_at_one() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury);
    assert_eq!(client.get_version(), 1u32);
}

/// Verifies escrow state is readable before and after a simulated upgrade
/// (version bump via direct storage write, bypassing WASM swap).
#[test]
fn test_escrow_state_preserved_across_version_bump() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury);

    let depositor = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&depositor, &500);

    let job_id = String::from_str(&env, "upgrade_job_1");
    client.create_escrow(
        &job_id,
        &depositor,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );

    // Simulate the version bump that upgrade() performs (without WASM swap)
    env.as_contract(&id, || {
        let v: u32 = env.storage().instance().get(&DataKey::Version).unwrap_or(1);
        env.storage().instance().set(&DataKey::Version, &(v + 1));
    });

    assert_eq!(client.get_version(), 2u32);

    // Escrow state intact
    let escrow = client.get_escrow(&job_id);
    assert_eq!(escrow.amount, 500);
    assert_eq!(escrow.status, EscrowStatus::Locked);
}

#[test]
#[should_panic]
fn test_upgrade_rejected_for_non_admin() {
    let env = Env::default();
    // Do NOT mock_all_auths — auth will fail for non-admin
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury);

    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    // Called without admin auth → should panic
    client.upgrade(&fake_hash);
}

#[test]
fn test_get_milestone_returns_correct_milestone() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &admin);

    let depositor = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&depositor, &1000);

    let mut ms = Vec::new(&env);
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 1"),
        percentage: 40,
    });
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 2"),
        percentage: 60,
    });

    let job_id = String::from_str(&env, "ms-getter-1");
    client.create_escrow(
        &job_id,
        &depositor,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: Some(ms),
            timeout_ledgers: None,
            referrer: None,
        },
    );

    let ms0 = client.get_milestone(&job_id, &0u32);
    assert_eq!(ms0.id, 0u32);
    assert_eq!(ms0.percentage, 40u32);

    let ms1 = client.get_milestone(&job_id, &1u32);
    assert_eq!(ms1.id, 1u32);
    assert_eq!(ms1.percentage, 60u32);
}

#[test]
#[should_panic(expected = "Milestone index out of bounds")]
fn test_get_milestone_out_of_bounds_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &admin);

    let depositor = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&depositor, &500);

    let mut ms = Vec::new(&env);
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Only milestone"),
        percentage: 100,
    });

    let job_id = String::from_str(&env, "ms-oob-1");
    client.create_escrow(
        &job_id,
        &depositor,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: Some(ms),
            timeout_ledgers: None,
            referrer: None,
        },
    );

    client.get_milestone(&job_id, &5u32);
}

#[test]
fn test_is_frozen_defaults_false() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &admin);
    assert!(!client.is_frozen());
}
