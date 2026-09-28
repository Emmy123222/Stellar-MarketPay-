#![cfg(test)]

use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

#[test]
#[should_panic(expected = "Escrow must be released to mint certificate")]
fn test_mint_certificate_locked_escrow_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));

    let escrow_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let job_id = String::from_str(&env, "job-123");

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&escrow_client, &1000);

    let params = crate::types::CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000i128,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };

    client.create_escrow(&job_id, &escrow_client, &params);

    let title = String::from_str(&env, "Test Job");

    // This should panic
    client.mint_certificate(&job_id, &title, &escrow_client);
}

#[test]
fn test_mint_certificate_success() {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(&env, &id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));

    let escrow_client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let job_id = String::from_str(&env, "job-123");

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(&env, &token_id);
    token_admin.mint(&escrow_client, &1000);

    let params = crate::types::CreateEscrowParams {
        freelancer: freelancer.clone(),
        token: token_id.clone(),
        amount: 1000i128,
        milestones: None,
        timeout_ledgers: None,
        referrer: None,
    };

    client.create_escrow(&job_id, &escrow_client, &params);
    client.start_work(&job_id, &freelancer);

    env.as_contract(&id, || {
        let mut escrow: crate::types::Escrow = env
            .storage()
            .instance()
            .get(&crate::types::DataKey::Escrow(job_id.clone()))
            .unwrap();
        escrow.status = crate::types::EscrowStatus::Released;
        env.storage()
            .instance()
            .set(&crate::types::DataKey::Escrow(job_id.clone()), &escrow);
    });

    let title = String::from_str(&env, "Test Job");
    client.mint_certificate(&job_id, &title, &escrow_client);
}
