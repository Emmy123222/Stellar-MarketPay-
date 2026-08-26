use soroban_sdk::{symbol_short, Address, BytesN, Env, String};

use crate::escrow::release_escrow_core;
use crate::helpers::check_not_frozen;
use crate::types::*;

#[allow(clippy::too_many_arguments)]
/// Client submits deliverable hash.
pub(crate) fn submit_client_deliverable(env: Env, job_id: String, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let mut submission: DeliverableSubmission = env
        .storage()
        .instance()
        .get(&DataKey::DeliverableSubmission(job_id.clone()))
        .unwrap_or_else(|| DeliverableSubmission {
            job_id: job_id.clone(),
            client_hash_submitted: false,
            freelancer_hash_submitted: false,
            hashes_match: false,
        });

    submission.client_hash_submitted = true;
    env.storage()
        .instance()
        .set(&DataKey::DeliverableSubmission(job_id.clone()), &submission);

    env.events()
        .publish((symbol_short!("clthash"), client), job_id);
}

/// Freelancer submits deliverable hash.
pub(crate) fn submit_freelancer_deliverable(env: Env, job_id: String, freelancer: Address) {
    freelancer.require_auth();
    check_not_frozen(&env);

    let mut submission: DeliverableSubmission = env
        .storage()
        .instance()
        .get(&DataKey::DeliverableSubmission(job_id.clone()))
        .unwrap_or_else(|| DeliverableSubmission {
            job_id: job_id.clone(),
            client_hash_submitted: false,
            freelancer_hash_submitted: false,
            hashes_match: false,
        });

    submission.freelancer_hash_submitted = true;
    env.storage()
        .instance()
        .set(&DataKey::DeliverableSubmission(job_id.clone()), &submission);

    env.events()
        .publish((symbol_short!("frelhash"), freelancer), job_id);
}

/// Oracle/freelancer submits the deliverable hash.
///
/// If it matches the expected deliverable hash stored in escrow,
/// the escrow is auto-released. If mismatched, escrow enters dispute.
pub(crate) fn submit_deliverable(
    env: Env,
    job_id: String,
    actual_hash: BytesN<32>,
    caller: Address,
) {
    caller.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");

    if caller != escrow.freelancer && caller != admin {
        panic!("Only freelancer or oracle can submit deliverable");
    }

    let expected_hash = escrow
        .deliverable_hash
        .clone()
        .expect("Escrow has no deliverable hash");

    if actual_hash == expected_hash {
        // Auto-release on successful deliverable verification.
        release_escrow_core(env.clone(), job_id.clone(), escrow);
        env.events()
            .publish((symbol_short!("dlv_ok"), job_id), (caller, actual_hash));
        return;
    }

    // Mismatch must explicitly enter dispute.
    escrow.status = EscrowStatus::Disputed;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    env.events()
        .publish((symbol_short!("dlv_bad"), job_id), (caller, actual_hash));
}

/// Auto-release if both hashes match (manual fallback if mismatch after 7 days).
pub(crate) fn check_deliverable_match(env: Env, job_id: String) -> bool {
    check_not_frozen(&env);

    let submission: DeliverableSubmission = env
        .storage()
        .instance()
        .get(&DataKey::DeliverableSubmission(job_id.clone()))
        .expect("Deliverable submission not found");

    // Both must be submitted
    if submission.client_hash_submitted && submission.freelancer_hash_submitted {
        let mut updated = submission.clone();
        updated.hashes_match = true;
        env.storage()
            .instance()
            .set(&DataKey::DeliverableSubmission(job_id), &updated);
        return true;
    }
    false
}

/// Get deliverable submission status.
pub(crate) fn get_deliverable_submission(env: Env, job_id: String) -> DeliverableSubmission {
    env.storage()
        .instance()
        .get(&DataKey::DeliverableSubmission(job_id))
        .expect("Deliverable submission not found")
}

/// Freelancer submits the SHA-256 hash of the completed deliverable.
/// Once submitted, the client can verify and call release_escrow.
pub(crate) fn submit_deliverable_hash(
    env: Env,
    job_id: String,
    freelancer: Address,
    hash: BytesN<32>,
) {
    freelancer.require_auth();

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.freelancer != freelancer {
        panic!("Only the freelancer can submit deliverable hash");
    }
    if escrow.deliverable_hash.is_none() {
        panic!("Escrow has no expected deliverable hash");
    }
    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Locked {
        panic!("Can only submit hash for active escrow");
    }

    env.storage()
        .instance()
        .set(&DataKey::FreelancerDeliverableHash(job_id.clone()), &hash);

    env.events()
        .publish((symbol_short!("dlv_sub"), freelancer), (job_id, hash));
}

/// Get the freelancer-submitted deliverable hash, if any.
pub(crate) fn get_freelancer_deliverable_hash(env: Env, job_id: String) -> Option<BytesN<32>> {
    env.storage()
        .instance()
        .get(&DataKey::FreelancerDeliverableHash(job_id))
}

/// Verify that the freelancer-submitted hash matches the expected hash.
/// Returns true if both exist and match, false otherwise.
pub(crate) fn verify_deliverable_hash(env: Env, job_id: String) -> bool {
    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    let Some(expected) = &escrow.deliverable_hash else {
        return false;
    };

    let Some(submitted) = env
        .storage()
        .instance()
        .get::<_, BytesN<32>>(&DataKey::FreelancerDeliverableHash(job_id))
    else {
        return false;
    };

    &submitted == expected
}
