use soroban_sdk::{symbol_short, Address, BytesN, Env, String, Vec};

use crate::helpers::{check_not_frozen, compute_bid_commitment};
use crate::types::*;

#[allow(clippy::too_many_arguments)]
/// Client commits to a budget amount (sealed-bid, prevents anchoring bias).
pub(crate) fn commit_budget(env: Env, job_id: String, budget_amount: i128, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    if budget_amount <= 0 {
        panic!("Budget must be positive");
    }

    let commitment = BudgetCommitment {
        job_id: job_id.clone(),
        client: client.clone(),
        budget_amount,
        is_revealed: false,
    };

    env.storage()
        .instance()
        .set(&DataKey::BudgetCommitment(job_id.clone()), &commitment);

    env.events()
        .publish((symbol_short!("budgtcmt"), client), job_id);
}

/// Reveal the budget. Auto-rejects bids over 150% of budget.
pub(crate) fn reveal_budget(env: Env, job_id: String, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let mut commitment: BudgetCommitment = env
        .storage()
        .instance()
        .get(&DataKey::BudgetCommitment(job_id.clone()))
        .expect("Budget commitment not found");

    if commitment.client != client {
        panic!("Only the client can reveal the budget");
    }
    if commitment.is_revealed {
        panic!("Budget already revealed");
    }

    commitment.is_revealed = true;
    env.storage()
        .instance()
        .set(&DataKey::BudgetCommitment(job_id.clone()), &commitment);

    env.events().publish(
        (symbol_short!("budgrvld"), client),
        commitment.budget_amount,
    );
}

/// Get budget commitment.
pub(crate) fn get_budget_commitment(env: Env, job_id: String) -> BudgetCommitment {
    env.storage()
        .instance()
        .get(&DataKey::BudgetCommitment(job_id))
        .expect("Budget commitment not found")
}

/// Freelancer submits a sealed commitment hash for their bid amount.
pub(crate) fn submit_bid_commitment(
    env: Env,
    job_id: String,
    freelancer: Address,
    commitment: BytesN<32>,
) {
    freelancer.require_auth();
    check_not_frozen(&env);

    // Ensure this job has a client-owned bidding session via budget commitment.
    let _budget: BudgetCommitment = env
        .storage()
        .instance()
        .get(&DataKey::BudgetCommitment(job_id.clone()))
        .expect("Budget commitment not found");

    if let Some(state) = env
        .storage()
        .instance()
        .get::<_, BiddingState>(&DataKey::BiddingState(job_id.clone()))
    {
        if state.is_closed {
            panic!("Bidding is closed");
        }
    }

    let key = DataKey::BidCommitment(job_id.clone(), freelancer.clone());
    if env.storage().instance().has(&key) {
        panic!("Bid commitment already submitted");
    }

    let bid_commitment = BidCommitment {
        job_id: job_id.clone(),
        freelancer: freelancer.clone(),
        commitment,
        submitted_at_ledger: env.ledger().sequence(),
        bid_revealed: false,
    };

    env.storage().instance().set(&key, &bid_commitment);
    env.events()
        .publish((symbol_short!("bid_cmt"), job_id), freelancer);
}

/// Client closes bidding and opens a reveal window.
pub(crate) fn close_bidding(env: Env, job_id: String, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let budget: BudgetCommitment = env
        .storage()
        .instance()
        .get(&DataKey::BudgetCommitment(job_id.clone()))
        .expect("Budget commitment not found");
    if budget.client != client {
        panic!("Only the client can close bidding");
    }

    if let Some(existing) = env
        .storage()
        .instance()
        .get::<_, BiddingState>(&DataKey::BiddingState(job_id.clone()))
    {
        if existing.is_closed {
            panic!("Bidding already closed");
        }
    }

    let closed_at = env.ledger().sequence();
    let reveal_deadline = closed_at
        .checked_add(REVEAL_WINDOW_LEDGERS)
        .expect("Reveal deadline overflow");

    let state = BiddingState {
        job_id: job_id.clone(),
        client: client.clone(),
        is_closed: true,
        closed_at_ledger: closed_at,
        reveal_deadline_ledger: reveal_deadline,
    };

    env.storage()
        .instance()
        .set(&DataKey::BiddingState(job_id.clone()), &state);
    env.events()
        .publish((symbol_short!("bid_cls"), job_id), reveal_deadline);
}

/// Freelancer reveals their sealed bid: amount + nonce.
pub(crate) fn reveal_bid(
    env: Env,
    job_id: String,
    freelancer: Address,
    amount: i128,
    nonce: BytesN<32>,
) {
    freelancer.require_auth();
    check_not_frozen(&env);

    if amount <= 0 {
        panic!("Bid amount must be positive");
    }

    let state: BiddingState = env
        .storage()
        .instance()
        .get(&DataKey::BiddingState(job_id.clone()))
        .expect("Bidding not closed");
    if !state.is_closed {
        panic!("Bidding not closed");
    }
    if env.ledger().sequence() > state.reveal_deadline_ledger {
        panic!("Reveal window has closed");
    }

    let key = DataKey::BidCommitment(job_id.clone(), freelancer.clone());
    let mut bid_commitment: BidCommitment = env
        .storage()
        .instance()
        .get(&key)
        .expect("Bid commitment not found");

    if bid_commitment.bid_revealed {
        panic!("Bid already revealed");
    }

    let expected = compute_bid_commitment(&env, amount, nonce);
    if expected != bid_commitment.commitment {
        panic!("Commitment verification failed");
    }

    bid_commitment.bid_revealed = true;
    env.storage().instance().set(&key, &bid_commitment);

    let mut reveals: Vec<RevealedBid> = env
        .storage()
        .instance()
        .get(&DataKey::RevealedBids(job_id.clone()))
        .unwrap_or_else(|| Vec::new(&env));
    reveals.push_back(RevealedBid {
        freelancer: freelancer.clone(),
        amount,
        revealed_at_ledger: env.ledger().sequence(),
    });
    env.storage()
        .instance()
        .set(&DataKey::RevealedBids(job_id.clone()), &reveals);

    env.events()
        .publish((symbol_short!("bid_rvl"), job_id), (freelancer, amount));
}

/// Read a freelancer's sealed bid commitment.
pub(crate) fn get_bid_commitment(env: Env, job_id: String, freelancer: Address) -> BidCommitment {
    env.storage()
        .instance()
        .get(&DataKey::BidCommitment(job_id, freelancer))
        .expect("Bid commitment not found")
}

/// Read all bids that were revealed during reveal phase.
pub(crate) fn get_revealed_bids(env: Env, job_id: String) -> Vec<RevealedBid> {
    env.storage()
        .instance()
        .get(&DataKey::RevealedBids(job_id))
        .unwrap_or_else(|| Vec::new(&env))
}
