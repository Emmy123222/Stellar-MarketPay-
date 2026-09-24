use soroban_sdk::{symbol_short, token, Address, Env, String, Symbol};

use crate::errors::ContractError;
use crate::governance::record_completed_job;
use crate::helpers::check_not_frozen;
use crate::types::*;

/// Load the escrow for `job_id` and run the authorization/state guard rails
/// shared by every release entry point.
fn load_releasable_escrow(env: &Env, job_id: &String, client: &Address) -> Escrow {
    check_not_frozen(env);

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if &escrow.client != client {
        panic!("Only the client can release a milestone");
    }
    if escrow.status != EscrowStatus::InProgress
        && escrow.status != EscrowStatus::Locked
        && escrow.status != EscrowStatus::Disputed
    {
        panic!("Cannot release milestone in current status");
    }

    escrow
}

/// Locate a milestone by its `id` and return its position in the escrow vector.
fn milestone_position(escrow: &Escrow, milestone_id: u32) -> u32 {
    for i in 0..escrow.milestones.len() {
        if escrow.milestones.get(i).unwrap().id == milestone_id {
            return i;
        }
    }
    panic!("Invalid milestone id");
}

/// Release the milestone sitting at `position` inside `escrow`.
///
/// Marks the milestone released, pays out its share of the escrow (net of the
/// platform fee) to the freelancer and emits the same `plat_fee` /
/// `milestone_released` events a single release would.
///
/// Shared by `release_milestone` and `release_all_milestones` so that a batch
/// release is exactly equivalent to calling `release_milestone` once per
/// milestone. The caller is responsible for persisting `escrow` and settling
/// the escrow status afterwards.
fn release_milestone_at(env: &Env, escrow: &mut Escrow, position: u32) -> i128 {
    let mut milestone = escrow.milestones.get(position).unwrap();
    if milestone.released {
        panic!("Milestone already released");
    }
    if milestone.rejected {
        panic!("Milestone already rejected");
    }
    for previous_milestone in escrow.milestones.iter() {
        if previous_milestone.id < milestone_id && !previous_milestone.released {
            panic!("{}", ContractError::PreviousMilestoneNotApproved.panic_message());
        }
    }

    milestone.released = true;
    escrow.milestones.set(position, milestone.clone());

    // Compute payout for this milestone's percentage of the total
    let payout = escrow
        .amount
        .checked_mul(milestone.percentage as i128)
        .expect("Arithmetic overflow")
        .checked_div(100)
        .expect("Arithmetic overflow");

    let token_client = token::Client::new(env, &escrow.token);

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
            (symbol_short!("plat_fee"), escrow.job_id.clone()),
            (treasury.clone(), fee_amount),
        );
    }

    // Transfer remaining funds to freelancer
    token_client.transfer(
        &env.current_contract_address(),
        &escrow.freelancer,
        &to_freelancer,
    );

    env.events().publish(
        (
            Symbol::new(env, "milestone_released"),
            escrow.job_id.clone(),
        ),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            milestone.id,
            payout,
        ),
    );

    payout
}

/// Close out the escrow once every milestone is resolved (released or rejected).
///
/// Mirrors the single-release completion path: the escrow transitions to
/// `Released`, the timeout entry is cleared and `CompletedJobs` is incremented
/// exactly once for both the freelancer and the client.
fn finalize_if_all_resolved(env: &Env, escrow: &mut Escrow) {
    let mut all_resolved = true;
    for ms in escrow.milestones.iter() {
        if !ms.released && !ms.rejected {
            all_resolved = false;
            break;
        }
    }
    if !all_resolved {
        return;
    }

    escrow.status = EscrowStatus::Released;
    env.storage()
        .instance()
        .remove(&DataKey::TimeoutTimestamp(escrow.job_id.clone()));

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

#[allow(clippy::too_many_arguments)]
/// Milestone-based partial release.
/// Can be called even if the escrow is Disputed, to release completed work.
pub(crate) fn release_milestone(env: Env, job_id: String, milestone_id: u32, client: Address) {
    client.require_auth();

    let mut escrow = load_releasable_escrow(&env, &job_id, &client);
    let position = milestone_position(&escrow, milestone_id);
    release_milestone_at(&env, &mut escrow, position);
    finalize_if_all_resolved(&env, &mut escrow);

    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);
}

/// Release every outstanding milestone of an escrow in a single call.
///
/// Clients approving work in bulk (e.g. a 5-milestone project) would otherwise
/// have to call `release_milestone` once per milestone; batching removes that
/// friction along with the per-transaction on-chain fees.
///
/// Guard rails:
///   * only the escrow client may call it,
///   * every milestone must have `rejected == false`,
///   * already-released milestones are skipped.
///
/// The result is therefore equivalent to calling `release_milestone` for each
/// outstanding milestone in ascending id order.
pub(crate) fn release_all_milestones(env: Env, job_id: String, client: Address) {
    client.require_auth();

    let mut escrow = load_releasable_escrow(&env, &job_id, &client);

    // A milestone-free escrow has nothing to release — and finishing it here
    // would mark the escrow Released while its funds stayed locked.
    if escrow.milestones.is_empty() {
        panic!("Escrow has no milestones");
    }

    // A batch release is only valid while no milestone has been rejected.
    for ms in escrow.milestones.iter() {
        if ms.rejected {
            panic!("Cannot batch release: a milestone was rejected");
        }
    }

    // Release every milestone that is still outstanding.
    for position in 0..escrow.milestones.len() {
        if !escrow.milestones.get(position).unwrap().released {
            release_milestone_at(&env, &mut escrow, position);
        }
    }

    finalize_if_all_resolved(&env, &mut escrow);

    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);
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
