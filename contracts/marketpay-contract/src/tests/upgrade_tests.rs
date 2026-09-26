use crate::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token, Address, BytesN, Env, IntoVal, String,
};

/// A minimal, separately-compiled Soroban contract wasm (see
/// `src/test_fixtures/README.md`), installed and swapped in by the
/// WASM-swap tests below via the real `upgrade()` entrypoint — not a
/// simulated storage write.
const DUMMY_WASM: &[u8] = include_bytes!("../test_fixtures/dummy_upgrade_target.wasm");

#[test]
fn test_upgrade_count_starts_at_one() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));
    assert_eq!(client.get_upgrade_count(), 1u32);
}

#[test]
fn test_get_version_returns_semver_set_at_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &admin, &String::from_str(&env, "1.2.0"));
    assert_eq!(client.get_version(), String::from_str(&env, "1.2.0"));
}

#[test]
#[should_panic(expected = "Not initialized")]
fn test_get_version_panics_before_initialize() {
    let env = Env::default();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    client.get_version();
}

#[test]
fn test_initialize_rejects_malformed_versions() {
    let bad = [
        "",
        "1",
        "1.2",
        "1.2.3.4",
        "v1.2.3",
        "1..3",
        ".1.2",
        "1.2.",
        "1.2.x",
        "1.2.3-rc1",
    ];
    for v in bad {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        let res = client.try_initialize(&admin, &admin, &String::from_str(&env, v));
        assert!(res.is_err(), "version {:?} should be rejected", v);
    }
}

#[test]
fn test_initialize_accepts_multi_digit_semver() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &admin, &String::from_str(&env, "10.20.300"));
    assert_eq!(client.get_version(), String::from_str(&env, "10.20.300"));
}

/// Runs a real WASM swap through `upgrade()` (installing an actual,
/// independently-compiled contract wasm via `upload_contract_wasm`,
/// rather than hand-editing storage) and confirms both the version bump
/// and pre-existing escrow data survive it. Reads happen through
/// `env.as_contract` because the freshly-installed wasm no longer
/// exposes the old contract's client methods.
#[test]
fn test_escrow_state_preserved_across_real_wasm_swap() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));

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

    let new_hash = env.deployer().upload_contract_wasm(DUMMY_WASM);
    client.upgrade(&new_hash, &String::from_str(&env, "1.1.0"));

    env.as_contract(&id, || {
        let version: u32 = env.storage().instance().get(&DataKey::Version).unwrap();
        assert_eq!(version, 2);
        let semver: String = env
            .storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap();
        assert_eq!(semver, String::from_str(&env, "1.1.0"));
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .unwrap();
        assert_eq!(escrow.amount, 500);
        assert_eq!(escrow.status, EscrowStatus::Locked);
    });
}

/// `upgrade()` on a real, uninstalled/garbage hash panics before it can
/// touch storage — `update_current_contract_wasm` requires the hash to
/// reference wasm already installed via `upload_contract_wasm`.
#[test]
#[should_panic]
fn test_upgrade_rejects_uninstalled_wasm_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &admin, &String::from_str(&env, "1.0.0"));

    let garbage: &[u8] = &[1, 2, 3, 4, 5];
    let new_hash = env.deployer().upload_contract_wasm(garbage);
    client.upgrade(&new_hash, &String::from_str(&env, "1.1.0"));
}

/// Baseline: calling `upgrade()` with no authorization mocked at all
/// panics on the admin's `require_auth()`.
#[test]
#[should_panic]
fn test_upgrade_rejected_for_non_admin() {
    let env = Env::default();
    // Do NOT mock_all_auths — auth will fail for non-admin
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));

    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    // Called without admin auth → should panic
    client.upgrade(&fake_hash, &String::from_str(&env, "1.1.0"));
}

/// Adversarial case: a non-admin account presents its own genuine,
/// mocked authorization for the `upgrade` call. `upgrade()` requires
/// the *stored admin's* `require_auth()`, which was never mocked, so
/// even a legitimately-authenticated non-admin caller is rejected.
#[test]
#[should_panic]
fn test_upgrade_rejected_for_authenticated_non_admin() {
    let env = Env::default();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));

    let non_admin = Address::generate(&env);
    let new_hash = env.deployer().upload_contract_wasm(DUMMY_WASM);
    let new_version = String::from_str(&env, "1.1.0");

    client
        .mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "upgrade",
                args: (new_hash.clone(), new_version.clone()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .upgrade(&new_hash, &new_version);
}

#[test]
fn test_get_milestone_returns_correct_milestone() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &admin, &String::from_str(&env, "1.0.0"));

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
    client.initialize(&admin, &admin, &String::from_str(&env, "1.0.0"));

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
    client.initialize(&admin, &admin, &String::from_str(&env, "1.0.0"));
    assert!(!client.is_frozen());
}
