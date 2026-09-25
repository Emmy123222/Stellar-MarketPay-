use crate::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env, String};

fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&admin, &admin);

    let contract_client = Address::generate(env);
    let freelancer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&contract_client, &1000);

    (client, contract_client, freelancer, token_id)
}

#[test]
fn test_client_requests_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-1");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    let current_ledger = env.ledger().sequence();
    let new_timeout = current_ledger + timeout_ledgers + 20;

    client.request_extension(&job_id, &contract_client, &new_timeout);

    let req = client.get_extension_request(&job_id).unwrap();
    assert_eq!(req.requested_by, contract_client);
    assert_eq!(req.new_timeout_ledger, new_timeout);
}

#[test]
fn test_freelancer_requests_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-2");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    let new_timeout = escrow.timeout_ledger + 20;

    client.request_extension(&job_id, &freelancer, &new_timeout);

    let req = client.get_extension_request(&job_id).unwrap();
    assert_eq!(req.requested_by, freelancer);
    assert_eq!(req.new_timeout_ledger, new_timeout);
}

#[test]
fn test_approve_extension_updates_timeout() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-3");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    let new_timeout = escrow.timeout_ledger + 50;

    client.request_extension(&job_id, &contract_client, &new_timeout);
    client.approve_extension(&job_id, &freelancer);

    let updated = client.get_escrow(&job_id);
    assert_eq!(updated.timeout_ledger, new_timeout);
    assert!(client.get_extension_request(&job_id).is_none());
}

#[test]
fn test_freelancer_requests_client_approves() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-4");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    let new_timeout = escrow.timeout_ledger + 30;

    client.request_extension(&job_id, &freelancer, &new_timeout);
    client.approve_extension(&job_id, &contract_client);

    let updated = client.get_escrow(&job_id);
    assert_eq!(updated.timeout_ledger, new_timeout);
}

#[test]
fn test_extension_after_start_work() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-5");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );
    client.start_work(&job_id, &freelancer);

    let escrow = client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::InProgress);

    let new_timeout = escrow.timeout_ledger + 20;
    client.request_extension(&job_id, &freelancer, &new_timeout);
    client.approve_extension(&job_id, &contract_client);

    let updated = client.get_escrow(&job_id);
    assert_eq!(updated.timeout_ledger, new_timeout);
}

#[test]
#[should_panic(expected = "An extension request is already pending")]
fn test_double_request_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-6");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    let new_timeout = escrow.timeout_ledger + 50;
    client.request_extension(&job_id, &contract_client, &new_timeout);
    client.request_extension(&job_id, &contract_client, &(new_timeout + 10));
}

#[test]
#[should_panic(expected = "Cannot approve your own extension request")]
fn test_cannot_approve_own_request() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-7");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    let new_timeout = escrow.timeout_ledger + 50;
    client.request_extension(&job_id, &contract_client, &new_timeout);
    client.approve_extension(&job_id, &contract_client);
}

#[test]
#[should_panic(expected = "New timeout must be later than current timeout")]
fn test_new_timeout_must_be_later() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-8");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    client.request_extension(&job_id, &contract_client, &escrow.timeout_ledger);
}

#[test]
#[should_panic(expected = "Cannot extend timeout in current status")]
fn test_extension_on_released_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-9");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );
    client.release_escrow(&job_id, &contract_client);

    let escrow = client.get_escrow(&job_id);
    client.request_extension(&job_id, &contract_client, &(escrow.timeout_ledger + 10));
}

#[test]
fn test_extension_request_getter_returns_none_when_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-10");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    assert!(client.get_extension_request(&job_id).is_none());
}

#[test]
#[should_panic(expected = "No pending extension request")]
fn test_approve_without_request_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id) = setup(&env);
    let job_id = String::from_str(&env, "ext-11");
    let timeout_ledgers = 10u32;

    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    client.approve_extension(&job_id, &freelancer);
}
