use crate::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, token, Address, Env, String};

fn setup_contract(
    env: &Env,
) -> (
    MarketPayContractClient,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury);

    let contract_client_addr = Address::generate(env);
    let freelancer = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(&contract_client_addr, &1000);

    (
        client,
        contract_client_addr,
        freelancer,
        token_id,
        admin,
        treasury,
    )
}

#[test]
fn test_timeout_refund_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "timeout_job_1");
    let timeout_ledgers = 10u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Locked);
    assert_eq!(
        escrow.timeout_ledger,
        env.ledger().sequence() + timeout_ledgers
    );

    // Advance ledger past timeout (both sequence and timestamp)
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 1;
    ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1) as u64; // Advance timestamp too
    env.ledger().set(ledger_info);

    client.timeout_refund(&job_id, &contract_client);

    let escrow_after = client.get_escrow(&job_id);
    assert_eq!(escrow_after.status, EscrowStatus::Refunded);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&contract_client), 1000);
}

#[test]
#[should_panic(expected = "Timeout period has not expired yet")]
fn test_timeout_refund_before_timeout_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "timeout_job_2");
    let timeout_ledgers = 100u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    // Try to timeout refund before timeout — should panic
    client.timeout_refund(&job_id, &contract_client);
}

#[test]
#[should_panic(expected = "Only the client can request a timeout refund")]
fn test_timeout_refund_unauthorized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "timeout_job_3");
    let timeout_ledgers = 5u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 1;
    env.ledger().set(ledger_info);

    let attacker = Address::generate(&env);
    client.timeout_refund(&job_id, &attacker);
}

#[test]
#[should_panic(expected = "Escrow is not in Locked state")]
fn test_timeout_refund_after_start_work_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "timeout_job_4");
    let timeout_ledgers = 10u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    // Start work changes status to InProgress (freelancer starts work)
    client.start_work(&job_id, &freelancer);

    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 1;
    env.ledger().set(ledger_info);

    client.timeout_refund(&job_id, &contract_client);
}

#[test]
fn test_timeout_refund_with_custom_timeout() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "custom_timeout_job");
    let custom_timeout = 50u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(custom_timeout),
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    assert_eq!(
        escrow.timeout_ledger,
        env.ledger().sequence() + custom_timeout
    );
}

#[test]
fn test_default_timeout_ledgers() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "default_timeout_job");
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );

    let escrow = client.get_escrow(&job_id);
    assert_eq!(
        escrow.timeout_ledger,
        env.ledger().sequence() + DEFAULT_TIMEOUT_LEDGERS
    );
}

#[test]
fn test_get_timeout_ledger() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "get_timeout_job");
    let timeout = 25u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 500,
            milestones: None,
            timeout_ledgers: Some(timeout),
            referrer: None,
        },
    );

    assert_eq!(
        client.get_timeout_ledger(&job_id),
        env.ledger().sequence() + timeout
    );
}

#[test]
fn test_timeout_refund_legacy_exact_ledger_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "legacy_timeout_exact");
    let timeout_ledgers = 10u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    // Remove TimeoutTimestamp to trigger legacy sequence-based fallback
    env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
    });

    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers; // EXACTLY at timeout_ledger
    env.ledger().set(ledger_info);

    client.timeout_refund(&job_id, &contract_client);

    let escrow_after = client.get_escrow(&job_id);
    assert_eq!(escrow_after.status, EscrowStatus::Refunded);

    let token_client = token::Client::new(&env, &token_id);
    assert_eq!(token_client.balance(&contract_client), 1000);
}

#[test]
#[should_panic(expected = "Timeout period has not expired yet")]
fn test_timeout_refund_legacy_one_ledger_before_failure() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "legacy_timeout_before");
    let timeout_ledgers = 10u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    // Remove TimeoutTimestamp to trigger legacy sequence-based fallback
    env.as_contract(&client.address, || {
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
    });

    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers - 1; // ONE ledger before timeout_ledger
    env.ledger().set(ledger_info);

    client.timeout_refund(&job_id, &contract_client);
}

#[test]
#[should_panic(expected = "Escrow is not in Locked state")]
fn test_concurrent_release_and_timeout_refund_release_first() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "concurrent_release_first");
    let timeout_ledgers = 10u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    // Advance ledger past timeout (both sequence and timestamp)
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 1;
    ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1) as u64;
    env.ledger().set(ledger_info);

    // First action: Release Escrow (succeeds)
    client.release_escrow(&job_id, &contract_client);

    let escrow_after = client.get_escrow(&job_id);
    assert_eq!(escrow_after.status, EscrowStatus::Released);

    // Second action: Timeout Refund (fails because status is no longer Locked)
    client.timeout_refund(&job_id, &contract_client);
}

#[test]
#[should_panic(expected = "Cannot release escrow in current status")]
fn test_concurrent_release_and_timeout_refund_timeout_first() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "concurrent_timeout_first");
    let timeout_ledgers = 10u32;
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(timeout_ledgers),
            referrer: None,
        },
    );

    // Advance ledger past timeout (both sequence and timestamp)
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 1;
    ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1) as u64;
    env.ledger().set(ledger_info);

    // First action: Timeout Refund (succeeds)
    client.timeout_refund(&job_id, &contract_client);

    let escrow_after = client.get_escrow(&job_id);
    assert_eq!(escrow_after.status, EscrowStatus::Refunded);

    // Second action: Release Escrow (fails because status is no longer InProgress/Locked)
    client.release_escrow(&job_id, &contract_client);
}
