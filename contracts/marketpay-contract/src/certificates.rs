use soroban_sdk::{symbol_short, Address, Bytes, Env, String, Vec};

use crate::helpers::check_not_frozen;
use crate::types::*;

#[allow(clippy::too_many_arguments)]
/// Mint a certificate when job is completed (upon escrow release).
///
/// The certificate is a proof-of-work NFT minted to the freelancer's
/// address. `title` is stored on-chain as part of the certificate
/// metadata so the certificate carries the job title (not just the id).
pub(crate) fn mint_certificate(env: Env, job_id: String, title: String, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if client != escrow.client {
        panic!("Only the escrow client can mint the certificate");
    }
    if title.is_empty() {
        panic!("Certificate title cannot be empty");
    }
    if escrow.status != EscrowStatus::Released {
        panic!("Escrow must be released to mint certificate");
    }
    if env
        .storage()
        .instance()
        .has(&DataKey::Certificate(job_id.clone()))
    {
        panic!("Certificate already minted");
    }

    let cert = Certificate {
        job_id: job_id.clone(),
        title: title.clone(),
        client: escrow.client.clone(),
        freelancer: escrow.freelancer.clone(),
        amount: escrow.amount,
        created_at: env.ledger().sequence(),
    };

    env.storage()
        .instance()
        .set(&DataKey::Certificate(job_id.clone()), &cert);

    let mut certs: Vec<String> = env
        .storage()
        .instance()
        .get(&DataKey::FreelancerCertificates(escrow.freelancer.clone()))
        .unwrap_or_else(|| Vec::new(&env));
    certs.push_back(job_id.clone());
    env.storage().instance().set(
        &DataKey::FreelancerCertificates(escrow.freelancer.clone()),
        &certs,
    );

    env.events()
        .publish((symbol_short!("certmnt"), client), (job_id, escrow.amount));
}

/// Append an IPFS CID to a job's on-chain dispute-evidence audit trail
/// (Issue #448 --- AC #1).
///
/// Caller: the escrow's client OR the escrow's freelancer. The explicit
/// `caller` parameter is `require_auth`'d so every chain row carries
/// cryptographic provenance of who anchored the CID.
///
/// Storage: a Soroban `Vec<Bytes>` of CID bytes is appended at
/// `DataKey::EvidenceCids(job_id)`. The vector is append-only; existing
/// entries are never overwritten.
pub(crate) fn submit_evidence_cid(env: Env, job_id: String, cid: Bytes, caller: Address) {
    caller.require_auth();
    check_not_frozen(&env);

    if cid.is_empty() {
        panic!("IPFS CID cannot be empty");
    }

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if caller != escrow.client && caller != escrow.freelancer {
        panic!("Only participants can record evidence");
    }

    if escrow.status == EscrowStatus::Refunded {
        panic!("Cannot record evidence on a refunded escrow");
    }

    let mut cids: soroban_sdk::Vec<Bytes> = env
        .storage()
        .instance()
        .get(&DataKey::EvidenceCids(job_id.clone()))
        .unwrap_or_else(|| soroban_sdk::Vec::new(&env));

    cids.push_back(cid);
    env.storage()
        .instance()
        .set(&DataKey::EvidenceCids(job_id.clone()), &cids);

    env.events().publish(
        (symbol_short!("evd_add"), job_id),
        (caller, env.ledger().sequence()),
    );
}

/// Get a certificate.
pub(crate) fn get_certificate(env: Env, job_id: String) -> Certificate {
    env.storage()
        .instance()
        .get(&DataKey::Certificate(job_id))
        .expect("Certificate not found")
}

/// Get all certificates for a freelancer.
pub(crate) fn get_freelancer_certificates(env: Env, freelancer: Address) -> Vec<String> {
    env.storage()
        .instance()
        .get(&DataKey::FreelancerCertificates(freelancer))
        .unwrap_or_else(|| Vec::new(&env))
}

pub(crate) fn submit_client_rating(env: Env, job_id: String, client: Address, score: u32) {
    client.require_auth();
    check_not_frozen(&env);
    if !(1..=5).contains(&score) {
        panic!("Score must be between 1 and 5");
    }

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    let mut stats: FreelancerRatingStats = env
        .storage()
        .instance()
        .get(&DataKey::FreelancerRatingStats(escrow.freelancer.clone()))
        .unwrap_or(FreelancerRatingStats {
            total_score: 0,
            count: 0,
        });
    stats.total_score = stats
        .total_score
        .checked_add(score)
        .expect("Arithmetic overflow");
    stats.count = stats.count.checked_add(1).expect("Arithmetic overflow");
    env.storage()
        .instance()
        .set(&DataKey::FreelancerRatingStats(escrow.freelancer), &stats);
}

pub(crate) fn submit_freelancer_rating(env: Env, job_id: String, freelancer: Address, score: u32) {
    freelancer.require_auth();
    check_not_frozen(&env);
    if !(1..=5).contains(&score) {
        panic!("Score must be between 1 and 5");
    }

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");
    if escrow.status != EscrowStatus::Released {
        panic!("Ratings are allowed only after escrow release");
    }
    if escrow.freelancer != freelancer {
        panic!("Only job freelancer can submit freelancer rating");
    }
    if env
        .storage()
        .instance()
        .has(&DataKey::FreelancerRating(job_id.clone()))
    {
        panic!("Freelancer rating already submitted for this job");
    }

    let rating = Rating {
        job_id: job_id.clone(),
        rater: freelancer,
        rated: escrow.client,
        score_out_of_5: score,
        submitted_at_ledger: env.ledger().sequence(),
    };
    env.storage()
        .instance()
        .set(&DataKey::FreelancerRating(job_id), &rating);
}

pub(crate) fn resolve_arbitration(env: Env, case_id: u32) {
    check_not_frozen(&env);

    let mut case: ArbitrationCase = env
        .storage()
        .instance()
        .get(&DataKey::ArbitrationCase(case_id))
        .expect("Arbitration case not found");
    if case.votes.len() != 3 {
        panic!("Exactly 3 votes required");
    }
    let vote_a = case.votes.get(0).unwrap();
    let vote_b = case.votes.get(1).unwrap();
    let vote_c = case.votes.get(2).unwrap();
    let min_vote = if vote_a < vote_b { vote_a } else { vote_b };
    let min_vote = if min_vote < vote_c { min_vote } else { vote_c };
    let max_vote = if vote_a > vote_b { vote_a } else { vote_b };
    let max_vote = if max_vote > vote_c { max_vote } else { vote_c };
    case.resolution = vote_a
        .checked_add(vote_b)
        .expect("Counter overflow")
        .checked_add(vote_c)
        .expect("Counter overflow")
        .checked_sub(min_vote)
        .expect("Arithmetic underflow")
        .checked_sub(max_vote)
        .expect("Arithmetic underflow");
    case.status = 1;
    env.storage()
        .instance()
        .set(&DataKey::ArbitrationCase(case_id), &case);

    env.events()
        .publish((symbol_short!("arb_rsl"), case_id), case.resolution);
}

/// Read the IPFS CIDs anchoring dispute evidence on-chain for a job
/// (Issue #448 --- AC #3). Returns the `Vec<Bytes>` in insertion order
/// (oldest first). Empty `Vec` if no evidence has been anchored yet.
pub(crate) fn get_evidence_cids(env: Env, job_id: String) -> soroban_sdk::Vec<Bytes> {
    env.storage()
        .instance()
        .get(&DataKey::EvidenceCids(job_id))
        .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
}
