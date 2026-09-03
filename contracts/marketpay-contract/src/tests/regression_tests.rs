use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Vec};

#[test]
fn test_release_escrow_state_consistency_regression() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract_client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    contract_client.initialize(&admin, &treasury);

    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_client = token::Client::new(&env, &token_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&client, &1000);

    let job_id = String::from_str(&env, "job1");
    contract_client.create_escrow(
        &job_id,
        &client.clone(),
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );
    contract_client.start_work(&job_id, &freelancer.clone());

    contract_client.release_escrow(&job_id, &client.clone());

    let escrow = contract_client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    // Fee = 1000 * 1% = 10. Freelancer gets 990.
    assert_eq!(token_client.balance(&freelancer), 990);
}

#[test]
fn test_release_with_conversion() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract_client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    contract_client.initialize(&admin, &treasury);

    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&client, &1000);

    let job_id = String::from_str(&env, "job_conv");
    contract_client.create_escrow(
        &job_id,
        &client.clone(),
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );

    let target_token = Address::generate(&env);
    contract_client.release_with_conversion(&job_id, &client.clone(), &target_token, &900);

    let escrow = contract_client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
}

#[test]
fn test_partial_release() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract_client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    contract_client.initialize(&admin, &treasury);

    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_client = token::Client::new(&env, &token_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&client, &1000);

    let mut milestones = Vec::new(&env);
    milestones.push_back(MilestoneInput {
        description: String::from_str(&env, "Design"),
        percentage: 40,
    });
    milestones.push_back(MilestoneInput {
        description: String::from_str(&env, "Build"),
        percentage: 60,
    });

    let job_id = String::from_str(&env, "job_partial");
    contract_client.create_escrow(
        &job_id,
        &client.clone(),
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: Some(milestones),
            timeout_ledgers: None,
            referrer: None,
        },
    );
    contract_client.start_work(&job_id, &freelancer.clone());

    // Raise dispute to test that we can still release milestones
    contract_client.raise_dispute(&job_id, &client.clone());

    contract_client.release_milestone(&job_id, &0u32, &client.clone());

    let escrow = contract_client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Disputed);
    // Milestone 0 = 40% = 400. Fee = 400 * 1% = 4. Freelancer gets 396.
    assert_eq!(token_client.balance(&freelancer), 396);
    assert!(escrow.milestones.get(0).unwrap().released);
    assert!(!escrow.milestones.get(1).unwrap().released);

    // Release final milestone
    contract_client.release_milestone(&job_id, &1u32, &client.clone());
    let escrow2 = contract_client.get_escrow(&job_id);
    assert_eq!(escrow2.status, EscrowStatus::Released);
    // Remaining 60% = 600. Fee = 600 * 1% = 6. Freelancer gets 594.
    // Total = 396 + 594 = 990
    assert_eq!(token_client.balance(&freelancer), 990);
}

#[test]
#[should_panic(expected = "Insufficient admin signatures to unfreeze")]
fn test_unfreeze_rejects_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env));
    client.freeze_contract(&admin);
    let signatures = Vec::from_array(&env, [admin]);
    client.unfreeze_contract(&signatures);
}

#[test]
// Soroban rejects duplicate authorization entries before contract execution
// when both entries are the same address; this is still a valid rejection.
#[should_panic(expected = "ExistingValue")]
fn test_unfreeze_rejects_duplicate_signatures() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let second_admin = Address::generate(&env);
    client.initialize(&admin, &Address::generate(&env));
    client.add_admin(&admin, &second_admin);
    client.freeze_contract(&admin);
    let signatures = Vec::from_array(&env, [admin.clone(), admin]);
    client.unfreeze_contract(&signatures);
}
