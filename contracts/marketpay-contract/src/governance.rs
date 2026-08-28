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
    check_not_frozen(&env);

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
    check_not_frozen(&env);

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
    check_not_frozen(&env);

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
    proposal.result = proposal.votes_for > proposal.votes_against;

    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    env.events().publish(
        (symbol_short!("resolved"), proposal_id),
        (proposal.result, proposal.votes_for, proposal.votes_against),
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
