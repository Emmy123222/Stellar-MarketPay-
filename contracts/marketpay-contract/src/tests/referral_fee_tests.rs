// ─── Issue #1180: adversarial coverage for platform fee & referral bonus ──────
use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

fn setup(
    env: &Env,
) -> (
    MarketPayContractClient,
    Address, // admin
    Address, // treasury
    Address, // client
    Address, // freelancer
    Address, // referrer
    Address, // token
) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    contract.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));

    let client = Address::generate(env);
    let freelancer = Address::generate(env);
    let referrer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&client, &1_000_000);

    (
        contract, admin, treasury, client, freelancer, referrer, token_id,
    )
}

fn referred_escrow(
    freelancer: &Address,
    referrer: &Address,
    token: &Address,
    amount: i128,
) -> CreateEscrowParams {
    CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token.clone(),
        amount,
        milestones: None,
        timeout_ledgers: None,
        referrer: Some(referrer.clone()),
    }
}

/// Adversarial case: platform fee pinned at its 10% ceiling *and* a
/// referrer bonus both apply to the same release. Even in this
/// worst-case combination, fee + bonus must never exceed the escrow
/// amount and every stroop must land in exactly one bucket.
#[test]
fn test_max_fee_plus_referral_bonus_never_exceeds_escrow_amount() {
    let env = Env::default();
    let (contract, admin, treasury, client, freelancer, referrer, token_id) = setup(&env);
    contract.set_platform_fee_bps(&admin, &1000); // 10% ceiling

    let job_id = String::from_str(&env, "job-max-fee");
    let params = referred_escrow(&freelancer, &referrer, &token_id, 10_000);
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let token_client = token::Client::new(&env, &token_id);
    let fee = token_client.balance(&treasury);
    let bonus = token_client.balance(&referrer);
    let payout = token_client.balance(&freelancer);

    assert_eq!(fee, 1_000); // 10% of 10_000
    assert_eq!(bonus, 180); // 2% of the post-fee 9_000
    assert_eq!(payout, 8_820);
    assert_eq!(fee + bonus + payout, 10_000);
    assert_eq!(token_client.balance(&contract.address), 0);
}

#[test]
#[should_panic(expected = "Platform fee cannot exceed 10% (1000 bps)")]
fn test_set_platform_fee_bps_rejects_above_ceiling() {
    let env = Env::default();
    let (contract, admin, ..) = setup(&env);
    contract.set_platform_fee_bps(&admin, &1001);
}

#[test]
#[should_panic(expected = "Only admin can set platform fee")]
fn test_set_platform_fee_bps_rejects_non_admin() {
    let env = Env::default();
    let (contract, _admin, _treasury, client, ..) = setup(&env);
    contract.set_platform_fee_bps(&client, &500);
}

/// Admin bonus cap: a cap lower than the uncapped 2% bonus must clamp
/// the referrer's payout, with the difference going to the freelancer.
#[test]
fn test_referrer_bonus_cap_clamps_payout_below_uncapped_amount() {
    let env = Env::default();
    let (contract, admin, treasury, client, freelancer, referrer, token_id) = setup(&env);
    contract.set_max_referrer_bonus_xlm(&admin, &50);
    assert_eq!(contract.get_max_referrer_bonus_xlm(), Some(50));

    let job_id = String::from_str(&env, "job-cap");
    let params = referred_escrow(&freelancer, &referrer, &token_id, 10_000);
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let token_client = token::Client::new(&env, &token_id);
    // Default 1% platform fee -> after_fee = 9_900; uncapped bonus would be 198.
    assert_eq!(token_client.balance(&treasury), 100);
    assert_eq!(token_client.balance(&referrer), 50);
    assert_eq!(token_client.balance(&freelancer), 9_850);
}

/// Admin bonus cap of 0 disables the referrer program entirely: the
/// referrer gets nothing and the freelancer keeps the full post-fee amount.
#[test]
fn test_referrer_bonus_cap_zero_disables_referral_program() {
    let env = Env::default();
    let (contract, admin, _treasury, client, freelancer, referrer, token_id) = setup(&env);
    contract.set_max_referrer_bonus_xlm(&admin, &0);

    let job_id = String::from_str(&env, "job-cap-zero");
    let params = referred_escrow(&freelancer, &referrer, &token_id, 10_000);
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&referrer), 0);
    assert_eq!(token_client.balance(&freelancer), 9_900); // full after-fee amount
}

/// A cap set above the uncapped bonus amount is a no-op: the legacy 2%
/// behaviour still applies since the cap only ever clamps downward.
#[test]
fn test_referrer_bonus_cap_above_uncapped_amount_has_no_effect() {
    let env = Env::default();
    let (contract, admin, _treasury, client, freelancer, referrer, token_id) = setup(&env);
    contract.set_max_referrer_bonus_xlm(&admin, &1_000_000);

    let job_id = String::from_str(&env, "job-cap-high");
    let params = referred_escrow(&freelancer, &referrer, &token_id, 10_000);
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&referrer), 198); // uncapped 2% of 9_900
}

#[test]
#[should_panic(expected = "Referrer bonus cap must be non-negative")]
fn test_set_max_referrer_bonus_xlm_rejects_negative_cap() {
    let env = Env::default();
    let (contract, admin, ..) = setup(&env);
    contract.set_max_referrer_bonus_xlm(&admin, &-1);
}

#[test]
#[should_panic(expected = "Only admin can set the referrer bonus cap")]
fn test_set_max_referrer_bonus_xlm_rejects_non_admin() {
    let env = Env::default();
    let (contract, _admin, _treasury, client, ..) = setup(&env);
    contract.set_max_referrer_bonus_xlm(&client, &100);
}

/// Issue #1379 acceptance: with a referrer, `release_escrow` transfers the
/// 2% bonus to the referrer and the freelancer receives `amount - bonus`.
#[test]
fn test_release_escrow_deducts_referral_bonus_when_referrer_set() {
    let env = Env::default();
    let (contract, admin, treasury, client, freelancer, referrer, token_id) = setup(&env);
    contract.set_platform_fee_bps(&admin, &0);

    let job_id = String::from_str(&env, "job-referral-ac");
    let params = referred_escrow(&freelancer, &referrer, &token_id, 10_000);
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&referrer), 200); // amount * 2 / 100
    assert_eq!(token_client.balance(&freelancer), 9_800); // amount - bonus
    assert_eq!(token_client.balance(&treasury), 0);
    assert_eq!(token_client.balance(&contract.address), 0);
}

/// Issue #1379 acceptance: without a referrer the freelancer receives the
/// full amount and no referral bonus is paid.
#[test]
fn test_release_escrow_pays_full_amount_without_referrer() {
    let env = Env::default();
    let (contract, admin, treasury, client, freelancer, _referrer, token_id) = setup(&env);
    contract.set_platform_fee_bps(&admin, &0);

    let job_id = String::from_str(&env, "job-no-referral-ac");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 10_000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&freelancer), 10_000);
    assert_eq!(token_client.balance(&treasury), 0);
    assert_eq!(token_client.balance(&contract.address), 0);
}

/// Issue #1379: the referrer bonus must also be honoured when the escrow is
/// released through the DEX-conversion path.
#[test]
fn test_release_with_conversion_deducts_referral_bonus_when_referrer_set() {
    let env = Env::default();
    let (contract, admin, treasury, client, freelancer, referrer, token_id) = setup(&env);
    contract.set_platform_fee_bps(&admin, &0);

    let job_id = String::from_str(&env, "job-conv-referral");
    let params = referred_escrow(&freelancer, &referrer, &token_id, 10_000);
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);

    let target_token = Address::generate(&env);
    contract.release_with_conversion(&job_id, &client, &target_token, &1);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&referrer), 200);
    assert_eq!(token_client.balance(&freelancer), 9_800);
    assert_eq!(token_client.balance(&treasury), 0);
}

/// Issue #1379: partial milestone releases must also pay the referrer bonus.
#[test]
fn test_release_milestone_deducts_referral_bonus_when_referrer_set() {
    let env = Env::default();
    let (contract, admin, treasury, client, freelancer, referrer, token_id) = setup(&env);
    contract.set_platform_fee_bps(&admin, &0);

    let mut milestones = soroban_sdk::Vec::new(&env);
    milestones.push_back(MilestoneInput {
        description: String::from_str(&env, "Design"),
        percentage: 100,
    });

    let job_id = String::from_str(&env, "job-ms-referral");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 10_000,
        milestones: Some(milestones),
        timeout_ledgers: None,
        referrer: Some(referrer.clone()),
    };
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_milestone(&job_id, &0u32, &client);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&referrer), 200);
    assert_eq!(token_client.balance(&freelancer), 9_800);
    assert_eq!(token_client.balance(&treasury), 0);
}
