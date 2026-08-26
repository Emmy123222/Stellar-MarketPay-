use soroban_sdk::{symbol_short, token, Address, Env, String, Symbol};

use crate::helpers::check_not_frozen;
use crate::types::*;

#[allow(clippy::too_many_arguments)]
/// Milestone-based partial release.
/// Can be called even if the escrow is Disputed, to release completed work.
pub(crate) fn release_milestone(env: Env, job_id: String, milestone_id: u32, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.client != client {
        panic!("Only the client can release a milestone");
    }
    if escrow.status != EscrowStatus::InProgress
        && escrow.status != EscrowStatus::Locked
        && escrow.status != EscrowStatus::Disputed
    {
        panic!("Cannot release milestone in current status");
    }

    let mut idx: Option<u32> = None;
    for i in 0..escrow.milestones.len() {
        if escrow.milestones.get(i).unwrap().id == milestone_id {
            idx = Some(i);
            break;
        }
    }
    let milestone_index = idx.expect("Invalid milestone id");

    let mut milestone = escrow.milestones.get(milestone_index).unwrap();
    if milestone.released {
        panic!("Milestone already released");
    }
    if milestone.rejected {
        panic!("Milestone already rejected");
    }

    milestone.released = true;
    escrow.milestones.set(milestone_index, milestone.clone());

    // Compute payout for this milestone's percentage of the total
    let payout = escrow
        .amount
        .checked_mul(milestone.percentage as i128)
        .expect("Arithmetic overflow")
        .checked_div(100)
        .expect("Arithmetic overflow");

    let token_client = token::Client::new(&env, &escrow.token);

    // ── Platform fee ────────────────────────────────────────────────────
    let fee_bps: u32 = env
        .storage()
        .instance()
        .get(&DataKey::PlatformFeeBps)
        .unwrap_or(0);
    let treasury: Address = env
        .storage()
        .instance()
        .get(&DataKey::TreasuryAddress)
        .expect("Treasury not set");
    let fee_amount = payout
        .checked_mul(fee_bps as i128)
        .expect("Arithmetic overflow")
        .checked_div(10_000)
        .expect("Arithmetic overflow");
    let to_freelancer = payout.checked_sub(fee_amount).expect("Arithmetic overflow");

    if fee_amount > 0 {
        token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
        env.events().publish(
            (symbol_short!("plat_fee"), job_id.clone()),
            (treasury.clone(), fee_amount),
        );
    }

    // Transfer remaining funds to freelancer
    token_client.transfer(
        &env.current_contract_address(),
        &escrow.freelancer,
        &to_freelancer,
    );

    // Check if all milestones are now resolved (released or rejected)
    let mut all_completed = true;
    for ms in escrow.milestones.iter() {
        if !ms.released && !ms.rejected {
            all_completed = false;
            break;
        }
    }

    if all_completed {
        escrow.status = EscrowStatus::Released;
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));

        // Increment CompletedJobs for the freelancer and client
        let freelancer_jobs: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CompletedJobs(escrow.freelancer.clone()))
            .unwrap_or(0);
        let new_freelancer_jobs = freelancer_jobs.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(
            &DataKey::CompletedJobs(escrow.freelancer.clone()),
            &new_freelancer_jobs,
        );

        let client_jobs: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CompletedJobs(escrow.client.clone()))
            .unwrap_or(0);
        let new_client_jobs = client_jobs.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(
            &DataKey::CompletedJobs(escrow.client.clone()),
            &new_client_jobs,
        );
    }

    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    env.events().publish(
        (Symbol::new(&env, "milestone_released"), job_id.clone()),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            milestone_id,
            payout,
        ),
    );
}

/// Partial milestone refund — the client rejects a single milestone and its
/// share of the escrow is returned to the client. Remaining milestones stay
/// locked in the contract.
///
/// Only the client may call this. The milestone is identified by its id
/// (the index assigned at creation time).
pub(crate) fn reject_milestone(env: Env, job_id: String, milestone_index: u32, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.client != client {
        panic!("Only the client can reject a milestone");
    }
    if escrow.status != EscrowStatus::InProgress
        && escrow.status != EscrowStatus::Locked
        && escrow.status != EscrowStatus::Disputed
    {
        panic!("Cannot reject milestone in current status");
    }

    let mut idx: Option<u32> = None;
    for i in 0..escrow.milestones.len() {
        if escrow.milestones.get(i).unwrap().id == milestone_index {
            idx = Some(i);
            break;
        }
    }
    let position = idx.expect("Invalid milestone id");

    let mut milestone = escrow.milestones.get(position).unwrap();
    if milestone.released {
        panic!("Milestone already released");
    }
    if milestone.rejected {
        panic!("Milestone already rejected");
    }

    milestone.rejected = true;
    escrow.milestones.set(position, milestone.clone());

    // Compute this milestone's percentage of the total and refund to client
    let refund = escrow
        .amount
        .checked_mul(milestone.percentage as i128)
        .expect("Arithmetic overflow")
        .checked_div(100)
        .expect("Arithmetic overflow");

    let token_client = token::Client::new(&env, &escrow.token);
    token_client.transfer(&env.current_contract_address(), &escrow.client, &refund);

    // If every milestone is now resolved (released or rejected), close out the escrow
    let mut all_resolved = true;
    for ms in escrow.milestones.iter() {
        if !ms.released && !ms.rejected {
            all_resolved = false;
            break;
        }
    }
    if all_resolved {
        escrow.status = EscrowStatus::Released;
        env.storage()
            .instance()
            .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
    }

    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    env.events().publish(
        (Symbol::new(&env, "milestone_rejected"), job_id.clone()),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            milestone_index,
            refund,
        ),
    );
}
