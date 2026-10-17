//! End-to-end integration test for the governance module lifecycle
//! (Issue #1820).
//!
//! Covers:
//! - Full happy path: propose -> vote -> reach quorum -> resolve -> observe timelock -> execute -> observe parameter change
//! - Failure path: vote after voting period deadline
//! - Failure path: execute proposal that failed quorum
//! - Failure path: execute proposal before timelock expiry
//! - Failure path: double execution attempt
//! - Failure path: quorum replay prevention

#![cfg(test)]

use marketpay_contract::{
    CreateEscrowParams, MarketPayContract, MarketPayContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

const VOTING_LEDGERS: u32 = 100;
const TIMELOCK_SECONDS: u64 = 172_800; // 2 days

struct GovernanceTestSetup<'a> {
    contract: MarketPayContractClient<'a>,
    admin: Address,
    proposer: Address,
    voters: Vec<Address>,
}

fn setup<'a>(env: &'a Env, voter_count: u32) -> GovernanceTestSetup<'a> {
    env.mock_all_auths();

    let contract_id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    contract.initialize(&admin, &treasury, &String::from_str(env, "1.0.0"));

    let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token_contract.address();
    let token_admin = token::StellarAssetClient::new(env, &token_id);

    // Seed eligible voters by creating and completing escrows
    let mut voters = Vec::new(env);
    for i in 0..voter_count {
        let buyer = Address::generate(env);
        let freelancer = Address::generate(env);
        token_admin.mint(&buyer, &1_000);

        let mut job_str = [0u8; 16];
        let id_str = i.to_string();
        let bytes = id_str.as_bytes();
        job_str[..bytes.len()].copy_from_slice(bytes);
        let job_id = String::from_str(env, core::str::from_utf8(&job_str[..bytes.len()]).unwrap());

        contract.create_escrow(
            &job_id,
            &buyer,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 100,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
            },
        );
        contract.start_work(&job_id, &freelancer);
        contract.release_escrow(&job_id, &buyer);

        // buyer and freelancer are now registered eligible voters
        voters.push_back(buyer);
        voters.push_back(freelancer);
    }

    let proposer = voters.get(0).unwrap();
    GovernanceTestSetup {
        contract,
        admin,
        proposer,
        voters,
    }
}

fn advance_ledgers(env: &Env, ledgers: u32) {
    let mut ledger = env.ledger().get();
    ledger.sequence_number += ledgers;
    env.ledger().set(ledger);
}

fn advance_timestamp(env: &Env, seconds: u64) {
    let mut ledger = env.ledger().get();
    ledger.timestamp += seconds;
    env.ledger().set(ledger);
}

// ─── Happy Path Integration Test ────────────────────────────────────────────

#[test]
fn test_governance_happy_path_proposal_lifecycle_to_parameter_change() {
    let env = Env::default();
    let s = setup(&env, 5); // 10 eligible voters

    // Initial default quorum is 1000 bps (10%)
    assert_eq!(s.contract.get_quorum_threshold_bps(), 1000);
    assert_eq!(s.contract.get_eligible_voter_count(), 10);

    // Propose changing quorum threshold to 2500 bps (25%)
    let new_quorum_bps = 2500u32;
    let pid = s.contract.propose_quorum_change(
        &s.proposer,
        &new_quorum_bps,
        &String::from_str(&env, "Increase quorum to 25%"),
        &VOTING_LEDGERS,
    );

    let proposal_before = s.contract.get_proposal(&pid);
    assert_eq!(proposal_before.id, pid);
    assert!(!proposal_before.resolved);
    assert!(!proposal_before.executed);

    // Cast votes: 3 YES votes, 1 NO vote out of 10 voters
    // Total votes = 4 >= 10% (1 vote needed) -> Quorum reached, YES > NO (3 > 1) -> Passes
    s.contract.cast_vote(&s.voters.get(0).unwrap(), &pid, &true);
    s.contract.cast_vote(&s.voters.get(1).unwrap(), &pid, &true);
    s.contract.cast_vote(&s.voters.get(2).unwrap(), &pid, &true);
    s.contract.cast_vote(&s.voters.get(3).unwrap(), &pid, &false);

    let proposal_voting = s.contract.get_proposal(&pid);
    assert_eq!(proposal_voting.votes_for, 3);
    assert_eq!(proposal_voting.votes_against, 1);

    // Advance past voting deadline
    advance_ledgers(&env, VOTING_LEDGERS + 1);

    // Resolve proposal
    s.contract.resolve_proposal(&pid);

    let proposal_resolved = s.contract.get_proposal(&pid);
    assert!(proposal_resolved.resolved);
    assert!(proposal_resolved.result, "Proposal must pass quorum and majority");
    assert!(!proposal_resolved.executed);

    // Advance past execution timelock (2 days)
    advance_timestamp(&env, TIMELOCK_SECONDS + 1);

    // Execute proposal
    s.contract.execute_proposal(&pid);

    let proposal_executed = s.contract.get_proposal(&pid);
    assert!(proposal_executed.executed, "Proposal must be marked executed");

    // Apply the parameter change and observe effect
    s.contract.set_quorum(&s.admin, &pid, &new_quorum_bps);
    assert_eq!(
        s.contract.get_quorum_threshold_bps(),
        new_quorum_bps,
        "Quorum threshold must update to 2500 bps"
    );
}

// ─── Failure Journeys Integration Tests ─────────────────────────────────────

#[test]
#[should_panic(expected = "Voting period has ended")]
fn test_governance_failure_voting_after_deadline_rejected() {
    let env = Env::default();
    let s = setup(&env, 2);

    let pid = s.contract.propose_quorum_change(
        &s.proposer,
        &2000,
        &String::from_str(&env, "Change quorum"),
        &VOTING_LEDGERS,
    );

    // Advance past the deadline
    advance_ledgers(&env, VOTING_LEDGERS + 1);

    // Attempting to vote after deadline must panic with VotingPeriodEnded (6004)
    s.contract.cast_vote(&s.voters.get(0).unwrap(), &pid, &true);
}

#[test]
#[should_panic(expected = "Proposal did not pass")]
fn test_governance_failure_execute_without_quorum_rejected() {
    let env = Env::default();
    let s = setup(&env, 10); // 20 voters, need at least 2 votes for 10% quorum

    let pid = s.contract.propose_quorum_change(
        &s.proposer,
        &2000,
        &String::from_str(&env, "Change quorum"),
        &VOTING_LEDGERS,
    );

    // Only 1 vote cast -> quorum missed (1 < 2)
    s.contract.cast_vote(&s.voters.get(0).unwrap(), &pid, &true);

    // Advance and resolve
    advance_ledgers(&env, VOTING_LEDGERS + 1);
    s.contract.resolve_proposal(&pid);

    let proposal = s.contract.get_proposal(&pid);
    assert!(proposal.resolved);
    assert!(!proposal.result, "Proposal must fail due to missed quorum");

    advance_timestamp(&env, TIMELOCK_SECONDS + 1);

    // Executing failed proposal must panic with ProposalDidNotPass (6014)
    s.contract.execute_proposal(&pid);
}

#[test]
#[should_panic(expected = "TimelockActive")]
fn test_governance_failure_execute_before_timelock_rejected() {
    let env = Env::default();
    let s = setup(&env, 2);

    let pid = s.contract.propose_quorum_change(
        &s.proposer,
        &2000,
        &String::from_str(&env, "Change quorum"),
        &VOTING_LEDGERS,
    );

    s.contract.cast_vote(&s.voters.get(0).unwrap(), &pid, &true);
    s.contract.cast_vote(&s.voters.get(1).unwrap(), &pid, &true);

    advance_ledgers(&env, VOTING_LEDGERS + 1);
    s.contract.resolve_proposal(&pid);

    // Timelock has not expired yet -> execute must panic with TimelockActive (6012)
    s.contract.execute_proposal(&pid);
}

#[test]
#[should_panic(expected = "Proposal already executed")]
fn test_governance_failure_double_execution_rejected() {
    let env = Env::default();
    let s = setup(&env, 2);

    let pid = s.contract.propose_quorum_change(
        &s.proposer,
        &2000,
        &String::from_str(&env, "Change quorum"),
        &VOTING_LEDGERS,
    );

    s.contract.cast_vote(&s.voters.get(0).unwrap(), &pid, &true);
    s.contract.cast_vote(&s.voters.get(1).unwrap(), &pid, &true);

    advance_ledgers(&env, VOTING_LEDGERS + 1);
    s.contract.resolve_proposal(&pid);

    advance_timestamp(&env, TIMELOCK_SECONDS + 1);

    // First execution succeeds
    s.contract.execute_proposal(&pid);

    // Second execution must panic with ProposalAlreadyExecuted (6015)
    s.contract.execute_proposal(&pid);
}

#[test]
#[should_panic(expected = "No matching quorum change proposal")]
fn test_governance_failure_quorum_change_replay_rejected() {
    let env = Env::default();
    let s = setup(&env, 2);

    let pid = s.contract.propose_quorum_change(
        &s.proposer,
        &2000,
        &String::from_str(&env, "Change quorum"),
        &VOTING_LEDGERS,
    );

    s.contract.cast_vote(&s.voters.get(0).unwrap(), &pid, &true);
    s.contract.cast_vote(&s.voters.get(1).unwrap(), &pid, &true);

    advance_ledgers(&env, VOTING_LEDGERS + 1);
    s.contract.resolve_proposal(&pid);
    advance_timestamp(&env, TIMELOCK_SECONDS + 1);
    s.contract.execute_proposal(&pid);

    // First application succeeds
    s.contract.set_quorum(&s.admin, &pid, &2000);

    // Replay attempt must panic with NoMatchingQuorumProposal (6011)
    s.contract.set_quorum(&s.admin, &pid, &2000);
}
