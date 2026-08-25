use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String};

fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    contract.initialize(&admin, &admin);
    contract.set_platform_fee_bps(&admin, &0);

    let client = Address::generate(env);
    let freelancer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&client, &1_000);

    (contract, client, freelancer, token_id)
}

#[test]
fn test_freelancer_submits_deliverable_hash() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-1");
    let expected_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    contract.create_escrow_with_deliverable(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
        &expected_hash,
    );

    contract.submit_deliverable_hash(&job_id, &freelancer, &expected_hash);

    let stored = contract.get_freelancer_deliverable_hash(&job_id);
    assert_eq!(stored, Some(expected_hash));
}

#[test]
fn test_release_succeeds_with_matching_hash() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-2");
    let expected_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    contract.create_escrow_with_deliverable(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
        &expected_hash,
    );

    contract.submit_deliverable_hash(&job_id, &freelancer, &expected_hash);
    contract.release_escrow(&job_id, &client);

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&freelancer), 1_000);
}

#[test]
#[should_panic(expected = "Freelancer deliverable hash does not match or not submitted")]
fn test_release_panics_without_submitting_hash() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-3");
    let expected_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    contract.create_escrow_with_deliverable(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
        &expected_hash,
    );

    contract.release_escrow(&job_id, &client);
}

#[test]
#[should_panic(expected = "Freelancer deliverable hash does not match or not submitted")]
fn test_release_panics_with_wrong_hash() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-4");
    let expected_hash = BytesN::from_array(&env, &[0xabu8; 32]);
    let wrong_hash = BytesN::from_array(&env, &[0xbbu8; 32]);

    contract.create_escrow_with_deliverable(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
        &expected_hash,
    );

    contract.submit_deliverable_hash(&job_id, &freelancer, &wrong_hash);
    contract.release_escrow(&job_id, &client);
}

#[test]
fn test_release_without_expected_hash_works() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-5");

    contract.create_escrow(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
}

#[test]
fn test_get_freelancer_hash_returns_none_when_empty() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-6");

    contract.create_escrow(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );

    let stored = contract.get_freelancer_deliverable_hash(&job_id);
    assert_eq!(stored, None);
}

#[test]
fn test_verify_deliverable_hash_returns_true_when_match() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-7");
    let expected_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    contract.create_escrow_with_deliverable(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
        &expected_hash,
    );

    contract.submit_deliverable_hash(&job_id, &freelancer, &expected_hash);

    assert!(contract.verify_deliverable_hash(&job_id));
}

#[test]
fn test_verify_deliverable_hash_false_when_not_submitted() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-8");
    let expected_hash = BytesN::from_array(&env, &[0xabu8; 32]);

    contract.create_escrow_with_deliverable(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
        &expected_hash,
    );

    assert!(!contract.verify_deliverable_hash(&job_id));
}

#[test]
#[should_panic(expected = "Only the freelancer can submit deliverable hash")]
fn test_non_freelancer_cannot_submit_hash() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "dh-job-9");
    let h = BytesN::from_array(&env, &[0xabu8; 32]);

    contract.create_escrow_with_deliverable(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
        &h,
    );

    contract.submit_deliverable_hash(&job_id, &client, &h);
}
