use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, BytesN, Env, String};

fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address, Address) {
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

    (contract, admin, client, freelancer, token_id)
}

#[test]
fn test_submit_deliverable_match_auto_releases() {
    let env = Env::default();
    let (contract, _admin, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "deliverable-match");
    let expected_hash = BytesN::from_array(&env, &[9u8; 32]);

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

    contract.submit_deliverable(&job_id, &expected_hash, &freelancer);

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);

    let token_client = token::Client::new(&env, &token_id);
    // Fee = 1000 * 1% = 10. Freelancer gets 990.
    assert_eq!(token_client.balance(&freelancer), 990);
}

#[test]
fn test_submit_deliverable_mismatch_enters_dispute() {
    let env = Env::default();
    let (contract, _admin, client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "deliverable-mismatch");
    let expected_hash = BytesN::from_array(&env, &[1u8; 32]);
    let actual_hash = BytesN::from_array(&env, &[2u8; 32]);

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

    contract.submit_deliverable(&job_id, &actual_hash, &freelancer);
    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Disputed);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&freelancer), 0);
}
