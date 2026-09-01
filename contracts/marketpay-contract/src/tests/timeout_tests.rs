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

// ========================================================================
// Adversarial edge-case tests (issue #1179)
// ========================================================================

// ── set_default_timeout_seconds ──────────────────────────────────────────

#[test]
fn test_set_default_timeout_seconds_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, admin, _treasury) = setup_contract(&env);

    let new_timeout: u32 = 120_000; // ~2.3 days in seconds
    client.set_default_timeout_seconds(&admin, &new_timeout);

    let stored = client.get_default_timeout_seconds();
    assert_eq!(stored, new_timeout);

    // A newly-created escrow should pick up the updated default.
    let job_id = String::from_str(&env, "new_timeout_job");
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
    // The escrow's timeout_ledger is ledger-based, but the timeout_timestamp
    // stored for the job should reflect the new seconds value.
    let stored_ts = client.get_timeout_timestamp(&job_id);
    let base_ts = env.ledger().timestamp() as u32;
    assert_eq!(stored_ts, base_ts + new_timeout);
}

#[test]
#[should_panic(expected = "Only admin can update the timeout")]
fn test_set_default_timeout_seconds_unauthorized_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _contract_client, _freelancer, _token_id, _admin, _treasury) =
        setup_contract(&env);

    let attacker = Address::generate(&env);
    client.set_default_timeout_seconds(&attacker, &86_400);
}

#[test]
#[should_panic(expected = "Timeout must be positive")]
fn test_set_default_timeout_seconds_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _contract_client, _freelancer, _token_id, admin, _treasury) = setup_contract(&env);

    client.set_default_timeout_seconds(&admin, &0);
}

// ── get_timeout_timestamp ───────────────────────────────────────────────

#[test]
fn test_get_timeout_timestamp_returns_correct_value() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "ts_job");
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

    let stored_ts = client.get_timeout_timestamp(&job_id);
    let base_ts = env.ledger().timestamp() as u32;
    assert_eq!(stored_ts, base_ts + DEFAULT_TIMEOUT_SECONDS);
}

#[test]
fn test_get_timeout_timestamp_nonexistent_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _contract_client, _freelancer, _token_id, _admin, _treasury) =
        setup_contract(&env);

    let missing = String::from_str(&env, "does_not_exist");
    assert_eq!(client.get_timeout_timestamp(&missing), 0);
}

// ── get_timeout_ledger edge cases ───────────────────────────────────────

#[test]
#[should_panic(expected = "Escrow not found")]
fn test_get_timeout_ledger_nonexistent_escrow_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _contract_client, _freelancer, _token_id, _admin, _treasury) =
        setup_contract(&env);

    let missing = String::from_str(&env, "ghost_job");
    client.get_timeout_ledger(&missing);
}

// ── timeout_refund adversarial paths ────────────────────────────────────

#[test]
#[should_panic(expected = "Escrow not found")]
fn test_timeout_refund_nonexistent_escrow_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _contract_client, _freelancer, _token_id, _admin, _treasury) =
        setup_contract(&env);

    let attacker = Address::generate(&env);
    let missing = String::from_str(&env, "phantom_job");
    client.timeout_refund(&missing, &attacker);
}

#[test]
#[should_panic(expected = "Escrow is not in Locked state")]
fn test_timeout_refund_already_refunded_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "double_refund");
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

    // Advance past timeout
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 1;
    ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1) as u64;
    env.ledger().set(ledger_info);

    // First refund succeeds
    client.timeout_refund(&job_id, &contract_client);
    let escrow = client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);

    // Second refund panics — status is no longer Locked
    client.timeout_refund(&job_id, &contract_client);
}

#[test]
#[should_panic(expected = "Escrow is not in Locked state")]
fn test_timeout_refund_already_released_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "released_then_timeout");
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

    // Freelancer starts work
    client.start_work(&job_id, &freelancer);
    let escrow = client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::InProgress);

    // Client releases escrow
    client.release_escrow(&job_id, &contract_client);
    let escrow = client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Released);

    // Now advance past timeout
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 10;
    ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1000) as u64;
    env.ledger().set(ledger_info);

    // Timeout refund fails — escrow is Released, not Locked
    client.timeout_refund(&job_id, &contract_client);
}

#[test]
#[should_panic(expected = "Timeout period has not expired yet")]
fn test_timeout_refund_exact_boundary_one_second_before_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "boundary_one_sec_before");
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(100),
            referrer: None,
        },
    );

    let mut ledger_info = env.ledger().get();
    // Ledger well past, but timestamp exactly ONE second before timeout
    ledger_info.sequence_number += 200;
    ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS - 1) as u64;
    env.ledger().set(ledger_info);

    client.timeout_refund(&job_id, &contract_client);
}

#[test]
fn test_timeout_refund_after_admin_shortened_timeout() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, admin, _treasury) = setup_contract(&env);

    // Admin sets a very short default timeout (100 seconds)
    client.set_default_timeout_seconds(&admin, &100);

    let job_id = String::from_str(&env, "short_timeout_job");
    client.create_escrow(
        &job_id,
        &contract_client,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id.clone(),
            amount: 1000,
            milestones: None,
            timeout_ledgers: Some(50),
            referrer: None,
        },
    );

    let stored_ts = client.get_timeout_timestamp(&job_id);
    let base_ts = env.ledger().timestamp() as u32;
    // TimeoutTimestamp should reflect the admin-set value (100s), not the default
    assert_eq!(stored_ts, base_ts + 100);

    // Advance past the shortened timeout
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += 51; // past the ledger timeout
    ledger_info.timestamp += 101; // past the timestamp timeout
    env.ledger().set(ledger_info);

    client.timeout_refund(&job_id, &contract_client);
    let escrow = client.get_escrow(&job_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
}

#[test]
#[should_panic(expected = "Escrow already exists for this job")]
fn test_timeout_refund_after_complete_refund_and_recreate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_client, freelancer, token_id, _admin, _treasury) = setup_contract(&env);

    let job_id = String::from_str(&env, "refund_recreate_job");
    let timeout_ledgers = 5u32;
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

    // Advance past timeout, refund
    let mut ledger_info = env.ledger().get();
    ledger_info.sequence_number += timeout_ledgers + 1;
    ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1) as u64;
    env.ledger().set(ledger_info);

    client.timeout_refund(&job_id, &contract_client);
    assert_eq!(client.get_escrow(&job_id).status, EscrowStatus::Refunded);

    // Attempt to create a new escrow with the same job_id — should panic
    // because the old record still exists with Refunded status
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
}
