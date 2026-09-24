use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

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

fn create_escrow(
    env: &Env,
    contract: &MarketPayContractClient,
    client: &Address,
    freelancer: &Address,
    token_id: &Address,
    job: &str,
) -> String {
    let job_id = String::from_str(env, job);
    contract.create_escrow(
        &job_id,
        client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1_000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );
    job_id
}

#[test]
fn test_freeze_escrow_sets_frozen_status() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-1");

    contract.freeze_escrow(&job_id, &admin);
    assert_eq!(contract.get_status(&job_id), EscrowStatus::Frozen);
}

#[test]
#[should_panic(expected = "Escrow is frozen")]
fn test_frozen_escrow_blocks_release() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-2");

    contract.start_work(&job_id, &freelancer);
    contract.freeze_escrow(&job_id, &admin);
    contract.release_escrow(&job_id, &client);
}

#[test]
#[should_panic(expected = "Escrow is frozen")]
fn test_frozen_escrow_blocks_start_work() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-3");

    contract.freeze_escrow(&job_id, &admin);
    contract.start_work(&job_id, &freelancer);
}

#[test]
#[should_panic(expected = "Escrow is frozen")]
fn test_frozen_escrow_blocks_refund() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-4");

    contract.freeze_escrow(&job_id, &admin);
    contract.refund_escrow(&job_id, &client);
}

#[test]
fn test_freeze_then_unfreeze_then_release_succeeds() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-5");

    contract.freeze_escrow(&job_id, &admin);
    assert_eq!(contract.get_status(&job_id), EscrowStatus::Frozen);
    contract.unfreeze_escrow(&job_id, &admin);

    // The escrow resumes its pre-freeze lifecycle.
    assert_eq!(contract.get_status(&job_id), EscrowStatus::Locked);
    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);

    assert_eq!(contract.get_status(&job_id), EscrowStatus::Released);
    let token_client = token::Client::new(&env, &token_id);
    // Full release: 1000 - 1% fee (10) = 990 to the freelancer.
    assert_eq!(token_client.balance(&freelancer), 990);
}

#[test]
#[should_panic(expected = "Only an admin can freeze the escrow")]
fn test_non_admin_cannot_freeze_escrow() {
    let env = Env::default();
    let (contract, _admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-6");

    let outsider = Address::generate(&env);
    contract.freeze_escrow(&job_id, &outsider);
}

#[test]
#[should_panic(expected = "Only an admin can freeze the escrow")]
fn test_non_admin_cannot_unfreeze_escrow() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-7");

    contract.freeze_escrow(&job_id, &admin);
    let outsider = Address::generate(&env);
    contract.unfreeze_escrow(&job_id, &outsider);
}

#[test]
#[should_panic(expected = "Escrow is already frozen")]
fn test_double_freeze_panics() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-8");

    contract.freeze_escrow(&job_id, &admin);
    contract.freeze_escrow(&job_id, &admin);
}

#[test]
#[should_panic(expected = "Escrow is not frozen")]
fn test_unfreeze_without_freeze_panics() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-9");

    contract.unfreeze_escrow(&job_id, &admin);
}

#[test]
#[should_panic(expected = "Escrow not found")]
fn test_freeze_nonexistent_escrow_panics() {
    let env = Env::default();
    let (contract, admin, _client, _freelancer, _token_id) = setup(&env);

    let job_id = String::from_str(&env, "frz-missing");
    contract.freeze_escrow(&job_id, &admin);
}

#[test]
#[should_panic(expected = "Cannot freeze a resolved escrow")]
fn test_cannot_freeze_released_escrow() {
    let env = Env::default();
    let (contract, admin, client, freelancer, token_id) = setup(&env);
    let job_id = create_escrow(&env, &contract, &client, &freelancer, &token_id, "frz-10");

    contract.start_work(&job_id, &freelancer);
    contract.release_escrow(&job_id, &client);
    contract.freeze_escrow(&job_id, &admin);
}
