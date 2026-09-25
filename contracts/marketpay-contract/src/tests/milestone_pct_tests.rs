use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Vec};

fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    contract.initialize(&admin, &treasury);

    let client = Address::generate(env);
    let freelancer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&client, &1_000);

    (contract, client, freelancer, token_id)
}

#[test]
fn test_create_escrow_with_milestones_valid() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ms-job-1");

    let mut ms = Vec::new(&env);
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 1"),
        percentage: 40,
    });
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 2"),
        percentage: 60,
    });

    contract.create_escrow_with_milestones(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: Some(ms),
            timeout_ledgers: None,
            referrer: None,
        },
    );

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.milestones.len(), 2);
}

#[test]
#[should_panic(expected = "Milestone percentages must sum to 100")]
fn test_invalid_percentages_rejected() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ms-job-2");

    let mut ms = Vec::new(&env);
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 1"),
        percentage: 40,
    });
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 2"),
        percentage: 50,
    });

    contract.create_escrow_with_milestones(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: Some(ms),
            timeout_ledgers: None,
            referrer: None,
        },
    );
}

#[test]
fn test_release_first_milestone() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ms-job-3");

    let mut ms = Vec::new(&env);
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 1"),
        percentage: 40,
    });
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 2"),
        percentage: 60,
    });

    contract.create_escrow_with_milestones(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: Some(ms),
            timeout_ledgers: None,
            referrer: None,
        },
    );
    contract.start_work(&job_id, &freelancer);
    contract.release_milestone(&job_id, &0u32, &client);

    let token_client = token::Client::new(&env, &token_id);
    // Milestone 0 = 40% = 400. Fee = 400 * 1% = 4. Freelancer gets 396.
    assert_eq!(token_client.balance(&freelancer), 396);

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::InProgress);
    assert!(escrow.milestones.get(0).unwrap().released);
}

#[test]
fn test_release_all_milestones_marks_released() {
    let env = Env::default();
    let (contract, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ms-job-4");

    let mut ms = Vec::new(&env);
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 1"),
        percentage: 40,
    });
    ms.push_back(MilestoneInput {
        description: String::from_str(&env, "Phase 2"),
        percentage: 60,
    });

    contract.create_escrow_with_milestones(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: Some(ms),
            timeout_ledgers: None,
            referrer: None,
        },
    );
    contract.start_work(&job_id, &freelancer);
    contract.release_milestone(&job_id, &0u32, &client);
    contract.release_milestone(&job_id, &1u32, &client);

    let token_client = token::Client::new(&env, &token_id);
    // Total fee = 1000 * 1% = 10. Freelancer gets 990.
    assert_eq!(token_client.balance(&freelancer), 990);

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
}
