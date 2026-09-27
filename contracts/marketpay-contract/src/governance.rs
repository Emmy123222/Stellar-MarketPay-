use soroban_sdk::{symbol_short, Address, Env, String, Vec};

use crate::helpers::check_not_frozen;
use crate::types::*;

pub(crate) fn create_proposal(
    env: Env,
    proposer: Address,
    title: String,
    description: String,
    duration_ledgers: u32,
) -> u32 {
    proposer.require_auth();
    check_not_frozen(&env, &title);

    if duration_ledgers == 0 {
        panic!("Duration must be positive");
    }

    let count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::ProposalCount)
        .unwrap_or(0);
    let proposal_id = count.checked_add(1).expect("Counter overflow");
    let deadline_ledger = env
        .ledger()
        .sequence()
        .checked_add(duration_ledgers)
        .expect("Arithmetic overflow");

    let proposal = Proposal {
        id: proposal_id,
        title: title.clone(),
        description: description.clone(),
        votes_for: 0,
        votes_against: 0,
        deadline_ledger,
        resolved: false,
        result: false,
    };

    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);
    env.storage()
        .instance()
        .set(&DataKey::ProposalCount, &proposal_id);

    env.events().publish(
        (symbol_short!("proposed"), proposer),
        (proposal_id, title, deadline_ledger),
    );

    proposal_id
}

pub(crate) fn cast_vote(env: Env, voter: Address, proposal_id: u32, approve: bool) {
    voter.require_auth();
    check_not_frozen(&env, proposal_id);

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&DataKey::Proposal(proposal_id))
        .expect("Proposal not found");

    if proposal.resolved {
        panic!("Proposal already resolved");
    }

    if env.ledger().sequence() >= proposal.deadline_ledger {
        panic!("Voting period has ended");
    }

    // Check eligibility: must have completed at least 1 job
    let jobs: u32 = env
        .storage()
        .instance()
        .get(&DataKey::CompletedJobs(voter.clone()))
        .unwrap_or(0);
    if jobs == 0 {
        panic!("Only users with completed jobs can vote");
    }

    // Check if already voted
    let voted_key = DataKey::HasVoted(voter.clone(), proposal_id);
    if env.storage().instance().has(&voted_key) {
        panic!("Voter has already cast a vote");
    }

    if approve {
        proposal.votes_for = proposal.votes_for.checked_add(1).expect("Counter overflow");
    } else {
        proposal.votes_against = proposal
            .votes_against
            .checked_add(1)
            .expect("Counter overflow");
    }

    env.storage().instance().set(&voted_key, &true);
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    env.events()
        .publish((symbol_short!("voted"), voter), (proposal_id, approve));
}

pub(crate) fn resolve_proposal(env: Env, proposal_id: u32) {
    check_not_frozen(&env, proposal_id);

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&DataKey::Proposal(proposal_id))
        .expect("Proposal not found");

    if proposal.resolved {
        panic!("Proposal already resolved");
    }

    if env.ledger().sequence() < proposal.deadline_ledger {
        panic!("Voting period is not over yet");
    }

    proposal.resolved = true;
    proposal.result = quorum_met(&env, &proposal) && proposal.votes_for > proposal.votes_against;

    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    env.events().publish(
        (symbol_short!("resolved"), proposal_id),
        (proposal.result, proposal.votes_for, proposal.votes_against),
    );
}

/// Cross-multiplied so fractional requirements round up without floats:
/// 15 eligible voters at 1000 bps need 2 votes, not 1.
fn quorum_met(env: &Env, proposal: &Proposal) -> bool {
    let eligible: u32 = env
        .storage()
        .instance()
        .get(&DataKey::EligibleVoterCount)
        .unwrap_or(0);
    let turnout = proposal.votes_for as u64 + proposal.votes_against as u64;
    turnout * 10_000 >= eligible as u64 * get_quorum_threshold_bps(env.clone()) as u64
}

/// Single write path for `CompletedJobs` so `EligibleVoterCount` (the quorum
/// denominator) stays in sync with who is allowed to vote.
pub(crate) fn record_completed_job(env: &Env, account: &Address) {
    let key = DataKey::CompletedJobs(account.clone());
    let jobs: u32 = env.storage().instance().get(&key).unwrap_or(0);
    if jobs == 0 {
        let eligible: u32 = env
            .storage()
            .instance()
            .get(&DataKey::EligibleVoterCount)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::EligibleVoterCount,
            &eligible.checked_add(1).expect("Counter overflow"),
        );
    }
    env.storage()
        .instance()
        .set(&key, &jobs.checked_add(1).expect("Counter overflow"));
}

fn validate_quorum_bps(new_threshold_bps: u32) {
    if new_threshold_bps > MAX_QUORUM_THRESHOLD_BPS {
        panic!("Quorum cannot exceed 50% (5000 bps)");
    }
}

pub(crate) fn get_quorum_threshold_bps(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::QuorumThresholdBps)
        .unwrap_or(DEFAULT_QUORUM_THRESHOLD_BPS)
}

pub(crate) fn get_eligible_voter_count(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::EligibleVoterCount)
        .unwrap_or(0)
}

/// Opens a regular proposal bound to `new_threshold_bps`; `set_quorum` can
/// only apply that exact value once this proposal has passed.
pub(crate) fn propose_quorum_change(
    env: Env,
    proposer: Address,
    new_threshold_bps: u32,
    description: String,
    duration_ledgers: u32,
) -> u32 {
    validate_quorum_bps(new_threshold_bps);

    let title = String::from_str(&env, "Quorum threshold change");
    let proposal_id = create_proposal(env.clone(), proposer, title, description, duration_ledgers);

    env.storage().instance().set(
        &DataKey::PendingQuorumChange(proposal_id),
        &new_threshold_bps,
    );
    env.events()
        .publish((symbol_short!("q_prop"), proposal_id), new_threshold_bps);

    proposal_id
}

pub(crate) fn set_quorum(env: Env, admin: Address, proposal_id: u32, new_threshold_bps: u32) {
    admin.require_auth();
    check_not_frozen(&env, proposal_id);

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    if stored_admin != admin {
        panic!("Only admin can set the quorum");
    }
    validate_quorum_bps(new_threshold_bps);

    let proposal = get_proposal(env.clone(), proposal_id);
    if !proposal.resolved || !proposal.result {
        panic!("Quorum change proposal has not passed");
    }

    let pending_key = DataKey::PendingQuorumChange(proposal_id);
    let pending: Option<u32> = env.storage().instance().get(&pending_key);
    if pending != Some(new_threshold_bps) {
        panic!("No matching quorum change proposal");
    }

    env.storage().instance().remove(&pending_key);
    env.storage()
        .instance()
        .set(&DataKey::QuorumThresholdBps, &new_threshold_bps);
    env.events().publish(
        (symbol_short!("quorum"), admin),
        (proposal_id, new_threshold_bps),
    );
}

pub(crate) fn get_proposal(env: Env, id: u32) -> Proposal {
    env.storage()
        .instance()
        .get(&DataKey::Proposal(id))
        .expect("Proposal not found")
}

pub(crate) fn list_active_proposals(env: Env) -> Vec<Proposal> {
    let count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::ProposalCount)
        .unwrap_or(0);
    let mut active = Vec::new(&env);
    for id in 1..=count {
        if let Some(proposal) = env
            .storage()
            .instance()
            .get::<_, Proposal>(&DataKey::Proposal(id))
        {
            if !proposal.resolved {
                active.push_back(proposal);
            }
        }
    }
    active
}
