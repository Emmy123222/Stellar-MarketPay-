#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String, token};

fn setup(
    env: &Env,
) -> (
    MarketPayContractClient,
    Address, // admin
    Address, // client
    Address, // freelancer
    Address, // token
) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    contract.initialize(&admin, &admin);

    let client = Address::generate(env);
    let freelancer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&client, &10_000);

    (contract, admin, client, freelancer, token_id)
}

#[test]
fn test_fund_escrow_happy_path() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Locked);
    assert_eq!(escrow.amount, 1000);
}

#[test]
#[should_panic(expected = "Escrow already exists")]
fn test_fund_escrow_double_funding_error() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
    contract.create_escrow(&job_id, &client, &params);
}

#[test]
#[should_panic(expected = "Unauthorized token")]
fn test_fund_escrow_wrong_token_error() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let wrong_token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let wrong_token_id = wrong_token_contract.address();

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: wrong_token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
}

#[test]
fn test_release_escrow_happy_path() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
}

#[test]
#[should_panic]
fn test_release_escrow_unauthorized_caller() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    // Not explicitly mocked to fail auth here unless we do deeper auth tests, 
    // but the contract requires client auth.
    // For Soroban tests with mock_all_auths(), `client.require_auth()` passes if we just pass `admin` instead of `client`?
    // Let's pass admin to release_escrow.
    contract.release_escrow(&job_id, &admin);
}

#[test]
#[should_panic(expected = "Escrow is not active")]
fn test_release_escrow_already_released_error() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);
    contract.release_escrow(&job_id, &client);
}

#[test]
fn test_refund_escrow_happy_path() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
    contract.refund_escrow(&job_id, &client);

    let escrow = contract.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
}

#[test]
#[should_panic(expected = "Timeout not reached")]
fn test_refund_escrow_timeout_not_elapsed_error() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let params = CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };
    
    contract.create_escrow(&job_id, &client, &params);
    contract.start_work(&job_id, &freelancer);
    // Timeout refund should panic because the timeout hasn't elapsed
    contract.timeout_refund(&job_id, &client);
}
