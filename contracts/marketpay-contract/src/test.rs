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

// ─── Job completion certificates (proof-of-work NFTs) ───────────────────────

#[test]
fn test_mint_certificate_happy_path() {
    let env = Env::default();
    let (contract, _admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let title = String::from_str(&env, "Build a dApp");
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

    contract.mint_certificate(&job_id, &title, &client);

    let cert = contract.get_certificate(&job_id);
    assert_eq!(cert.job_id, job_id);
    assert_eq!(cert.title, title);
    assert_eq!(cert.client, client);
    assert_eq!(cert.freelancer, freelancer);
    assert_eq!(cert.amount, 1000);

    let freelancer_certs = contract.get_freelancer_certificates(&freelancer);
    assert_eq!(freelancer_certs.len(), 1);
    assert_eq!(freelancer_certs.get(0).unwrap(), job_id);
}

#[test]
#[should_panic(expected = "Escrow must be released to mint certificate")]
fn test_mint_certificate_before_release_panics() {
    let env = Env::default();
    let (contract, _admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let title = String::from_str(&env, "Build a dApp");
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
    // Escrow is InProgress — minting must panic until released
    contract.mint_certificate(&job_id, &title, &client);
}

#[test]
#[should_panic(expected = "Only the escrow client can mint the certificate")]
fn test_mint_certificate_non_client_panics() {
    let env = Env::default();
    let (contract, _admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let title = String::from_str(&env, "Build a dApp");
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

    // A third party (not the escrow client) must not be able to mint.
    let stranger = Address::generate(&env);
    contract.mint_certificate(&job_id, &title, &stranger);
}

#[test]
#[should_panic(expected = "Certificate already minted")]
fn test_mint_certificate_double_mint_panics() {
    let env = Env::default();
    let (contract, _admin, client, freelancer, token_id) = setup(&env);

    let job_id = String::from_str(&env, "job1");
    let title = String::from_str(&env, "Build a dApp");
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

    contract.mint_certificate(&job_id, &title, &client);
    contract.mint_certificate(&job_id, &title, &client);
}
