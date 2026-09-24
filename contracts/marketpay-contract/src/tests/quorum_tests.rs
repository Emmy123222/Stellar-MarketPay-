use crate::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, token, Address, Env, String, Vec};

const VOTING_LEDGERS: u32 = 10;

fn setup(env: &Env) -> (MarketPayContractClient, Address, Address) {
    env.mock_all_auths();
    let id = env.register(MarketPayContract, ());
    let client = MarketPayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&admin, &Address::generate(env));
    (client, id, admin)
}

fn seed_voters(env: &Env, id: &Address, n: u32) -> Vec<Address> {
    let mut voters = Vec::new(env);
    env.as_contract(id, || {
        for _ in 0..n {
            let voter = Address::generate(env);
            crate::governance::record_completed_job(env, &voter);
            voters.push_back(voter);
        }
    });
    voters
}

fn advance(env: &Env) {
    let mut ledger = env.ledger().get();
    ledger.sequence_number += VOTING_LEDGERS;
    env.ledger().set(ledger);
}

fn vote_and_resolve(
    env: &Env,
    client: &MarketPayContractClient,
    pid: u32,
    voters: &Vec<Address>,
    yes: u32,
    no: u32,
) -> bool {
    for i in 0..yes {
        client.cast_vote(&voters.get(i).unwrap(), &pid, &true);
    }
    for i in yes..yes + no {
        client.cast_vote(&voters.get(i).unwrap(), &pid, &false);
    }
    advance(env);
    client.resolve_proposal(&pid);
    client.get_proposal(&pid).result
}

fn plain_proposal(env: &Env, client: &MarketPayContractClient, proposer: &Address) -> u32 {
    client.create_proposal(
        proposer,
        &String::from_str(env, "p"),
        &String::from_str(env, "d"),
        &VOTING_LEDGERS,
    )
}

fn quorum_proposal(
    env: &Env,
    client: &MarketPayContractClient,
    proposer: &Address,
    bps: u32,
) -> u32 {
    client.propose_quorum_change(proposer, &bps, &String::from_str(env, "d"), &VOTING_LEDGERS)
}

fn apply_quorum_via_governance(
    env: &Env,
    client: &MarketPayContractClient,
    admin: &Address,
    voters: &Vec<Address>,
    bps: u32,
) {
    let pid = quorum_proposal(env, client, admin, bps);
    assert!(vote_and_resolve(env, client, pid, voters, voters.len(), 0));
    client.set_quorum(admin, &pid, &bps);
}

// ─── Defaults & voter tracking ───────────────────────────────────────────────

#[test]
fn test_default_quorum_is_1000_bps() {
    let env = Env::default();
    let (client, _, _) = setup(&env);
    assert_eq!(client.get_quorum_threshold_bps(), 1000);
}

#[test]
fn test_eligible_voter_count_counts_distinct_accounts() {
    let env = Env::default();
    let (client, id, _) = setup(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    env.as_contract(&id, || {
        crate::governance::record_completed_job(&env, &a);
        crate::governance::record_completed_job(&env, &a);
        crate::governance::record_completed_job(&env, &b);
    });
    assert_eq!(client.get_eligible_voter_count(), 2);
}

#[test]
fn test_release_escrow_registers_both_parties_as_eligible_voters() {
    let env = Env::default();
    let (client, _, admin) = setup(&env);
    let buyer = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin).address();
    token::StellarAssetClient::new(&env, &token_id).mint(&buyer, &1000);

    let job_id = String::from_str(&env, "job1");
    client.create_escrow(
        &job_id,
        &buyer,
        &CreateEscrowParams {
            freelancer: freelancer.clone(),
            token: token_id,
            amount: 1000,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );
    client.start_work(&job_id, &freelancer);
    client.release_escrow(&job_id, &buyer);

    assert_eq!(client.get_eligible_voter_count(), 2);
}

// ─── Quorum enforcement at resolution ────────────────────────────────────────

#[test]
fn test_proposal_fails_one_vote_below_default_quorum() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 20); // 10% of 20 = 2 votes
    let pid = plain_proposal(&env, &client, &admin);
    assert!(!vote_and_resolve(&env, &client, pid, &voters, 1, 0));
    assert!(client.get_proposal(&pid).resolved);
}

#[test]
fn test_proposal_passes_exactly_at_default_quorum() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 20);
    let pid = plain_proposal(&env, &client, &admin);
    assert!(vote_and_resolve(&env, &client, pid, &voters, 2, 0));
}

#[test]
fn test_votes_against_count_toward_quorum() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 30); // need 3 votes
    let pid = plain_proposal(&env, &client, &admin);
    assert!(vote_and_resolve(&env, &client, pid, &voters, 2, 1));
}

#[test]
fn test_fractional_quorum_rounds_up() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 15); // 1.5 votes -> 2 required

    let below = plain_proposal(&env, &client, &admin);
    assert!(!vote_and_resolve(&env, &client, below, &voters, 1, 0));

    let at = plain_proposal(&env, &client, &admin);
    assert!(vote_and_resolve(&env, &client, at, &voters, 2, 0));
}

#[test]
fn test_no_eligible_voters_means_quorum_trivially_met() {
    let env = Env::default();
    let (client, _, admin) = setup(&env);
    let voters = Vec::<Address>::new(&env);
    let pid = plain_proposal(&env, &client, &admin);
    // Majority rule still applies: 0 vs 0 is not a pass.
    assert!(!vote_and_resolve(&env, &client, pid, &voters, 0, 0));
    assert_eq!(client.get_eligible_voter_count(), 0);
}

// ─── Edge values of the threshold ────────────────────────────────────────────

#[test]
fn test_quorum_at_max_5000_bps_boundary() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    apply_quorum_via_governance(&env, &client, &admin, &voters, 5000);
    assert_eq!(client.get_quorum_threshold_bps(), 5000);

    let below = plain_proposal(&env, &client, &admin);
    assert!(!vote_and_resolve(&env, &client, below, &voters, 4, 0));

    let at = plain_proposal(&env, &client, &admin);
    assert!(vote_and_resolve(&env, &client, at, &voters, 5, 0));
}

#[test]
fn test_quorum_at_zero_bps_only_requires_majority() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    apply_quorum_via_governance(&env, &client, &admin, &voters, 0);
    assert_eq!(client.get_quorum_threshold_bps(), 0);

    let voters = seed_voters(&env, &id, 90); // 100 eligible total
    let pid = plain_proposal(&env, &client, &admin);
    assert!(vote_and_resolve(&env, &client, pid, &voters, 1, 0));
}

#[test]
fn test_quorum_at_1_bps_requires_one_vote() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    apply_quorum_via_governance(&env, &client, &admin, &voters, 1);

    let pid = plain_proposal(&env, &client, &admin);
    assert!(vote_and_resolve(&env, &client, pid, &voters, 1, 0));
}

#[test]
#[should_panic(expected = "Quorum cannot exceed 50% (5000 bps)")]
fn test_propose_quorum_change_above_max_panics() {
    let env = Env::default();
    let (client, _, admin) = setup(&env);
    quorum_proposal(&env, &client, &admin, 5001);
}

#[test]
#[should_panic(expected = "Quorum cannot exceed 50% (5000 bps)")]
fn test_set_quorum_above_max_panics() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    let pid = quorum_proposal(&env, &client, &admin, 5000);
    vote_and_resolve(&env, &client, pid, &voters, 10, 0);
    client.set_quorum(&admin, &pid, &5001);
}

// ─── Meta-governance gating ──────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Quorum change proposal has not passed")]
fn test_set_quorum_rejects_unresolved_proposal() {
    let env = Env::default();
    let (client, _, admin) = setup(&env);
    let pid = quorum_proposal(&env, &client, &admin, 2000);
    client.set_quorum(&admin, &pid, &2000);
}

#[test]
#[should_panic(expected = "Quorum change proposal has not passed")]
fn test_set_quorum_rejects_voted_down_proposal() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    let pid = quorum_proposal(&env, &client, &admin, 2000);
    assert!(!vote_and_resolve(&env, &client, pid, &voters, 3, 7));
    client.set_quorum(&admin, &pid, &2000);
}

#[test]
#[should_panic(expected = "Quorum change proposal has not passed")]
fn test_set_quorum_rejects_proposal_that_missed_quorum() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 20); // need 2 votes
    let pid = quorum_proposal(&env, &client, &admin, 2000);
    assert!(!vote_and_resolve(&env, &client, pid, &voters, 1, 0));
    client.set_quorum(&admin, &pid, &2000);
}

#[test]
#[should_panic(expected = "No matching quorum change proposal")]
fn test_set_quorum_rejects_value_mismatch() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    let pid = quorum_proposal(&env, &client, &admin, 2000);
    vote_and_resolve(&env, &client, pid, &voters, 10, 0);
    client.set_quorum(&admin, &pid, &3000);
}

#[test]
#[should_panic(expected = "No matching quorum change proposal")]
fn test_set_quorum_rejects_regular_proposal() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    let pid = plain_proposal(&env, &client, &admin);
    assert!(vote_and_resolve(&env, &client, pid, &voters, 10, 0));
    client.set_quorum(&admin, &pid, &2000);
}

#[test]
#[should_panic(expected = "No matching quorum change proposal")]
fn test_set_quorum_cannot_be_replayed() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    let pid = quorum_proposal(&env, &client, &admin, 2000);
    vote_and_resolve(&env, &client, pid, &voters, 10, 0);
    client.set_quorum(&admin, &pid, &2000);
    client.set_quorum(&admin, &pid, &2000);
}

#[test]
#[should_panic(expected = "Only admin can set the quorum")]
fn test_set_quorum_rejects_non_admin() {
    let env = Env::default();
    let (client, id, admin) = setup(&env);
    let voters = seed_voters(&env, &id, 10);
    let pid = quorum_proposal(&env, &client, &admin, 2000);
    vote_and_resolve(&env, &client, pid, &voters, 10, 0);
    client.set_quorum(&Address::generate(&env), &pid, &2000);
}
