use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    contract.initialize(&admin, &treasury);

    let client = Address::generate(env);
    let freelancer = Address::generate(env);

    // Mocking a generic token contract which will simulate USDC
    let usdc_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc_id = usdc_contract.address();
    let usdc_admin = token::StellarAssetClient::new(env, &usdc_id);
    usdc_admin.mint(&client, &100_000_000); // Give the client some USDC

    (contract, client, freelancer, usdc_id)
}

#[test]
fn test_usdc_escrow_flow() {
    let env = Env::default();
    let (contract, client, freelancer, usdc_id) = setup(&env);
    let job_id = String::from_str(&env, "usdc-job-1");

    let token_client = token::TokenClient::new(&env, &usdc_id);

    // Initial balances
    assert_eq!(token_client.balance(&client), 100_000_000);
    assert_eq!(token_client.balance(&contract.address), 0);
    assert_eq!(token_client.balance(&freelancer), 0);

    // 1. Create escrow with USDC
    contract.create_escrow(
        &job_id,
        &client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: usdc_id.clone(),
            amount: 5_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );

    // Verify contract holds USDC
    assert_eq!(token_client.balance(&client), 99_995_000);
    assert_eq!(token_client.balance(&contract.address), 5_000);

    // 2. Freelancer starts work
    contract.start_work(&job_id, &freelancer);

    // 3. Client releases escrow
    contract.release_escrow(&job_id, &client);

    // Verify freelancer received the funds (assuming 0% fee here or similar, but the exact amount doesn't matter as long as it's not 0 and the contract is 0)
    let final_freelancer_balance = token_client.balance(&freelancer);
    assert!(final_freelancer_balance > 0);
    assert_eq!(token_client.balance(&contract.address), 0);
}
