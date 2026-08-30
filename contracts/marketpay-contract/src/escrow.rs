use soroban_sdk::{symbol_short, token, Address, BytesN, Env, String};

use crate::helpers::check_not_frozen;
use crate::types::*;

/// Creates an escrow for a job between a client and freelancer.
///   token          — address of the SPL-token used for payment
///   amount         — amount in token's smallest unit (e.g. stroops for XLM)
///   milestones     — optional list of milestones (max 5, percentages must sum to 100)
///   timeout_ledgers  — optional ledger timeout (default 7 days)
///   referrer         — optional referrer address; receives 2% bonus on release
pub(crate) fn create_escrow(env: Env, job_id: String, client: Address, params: CreateEscrowParams) {
    create_escrow_internal(
        env,
        job_id,
        client,
        params.freelancer,
        params.token,
        params.amount,
        params.milestones,
        params.timeout_ledgers,
        params.referrer,
        None,
    )
}

/// Client creates an escrow that includes an expected deliverable hash.
pub(crate) fn create_escrow_with_deliverable(
    env: Env,
    job_id: String,
    client: Address,
    params: CreateEscrowParams,
    deliverable_hash: BytesN<32>,
) {
    create_escrow_internal(
        env,
        job_id,
        client,
        params.freelancer,
        params.token,
        params.amount,
        params.milestones,
        params.timeout_ledgers,
        params.referrer,
        Some(deliverable_hash),
    )
}

// Client creates an escrow with percentage-based milestones.
// milestone percentages must sum to 100.
pub(crate) fn create_escrow_with_milestones(
    env: Env,
    job_id: String,
    client: Address,
    params: CreateEscrowParams,
) {
    create_escrow_internal(
        env,
        job_id,
        client,
        params.freelancer,
        params.token,
        params.amount,
        params.milestones,
        params.timeout_ledgers,
        params.referrer,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_escrow_internal(
    env: Env,
    job_id: String,
    client: Address,
    freelancer: Address,
    token: Address,
    amount: i128,
    milestones: Option<soroban_sdk::Vec<MilestoneInput>>,
    timeout_ledgers: Option<u32>,
    referrer: Option<Address>,
    deliverable_hash: Option<BytesN<32>>,
) {
    client.require_auth();
    check_not_frozen(&env);

    if amount <= 0 {
        panic!("Amount must be positive");
    }

    // Referrer must not be the freelancer or client
    if let Some(ref r) = referrer {
        if r == &client || r == &freelancer {
            panic!("Referrer cannot be the client or freelancer");
        }
    }

    // Validate milestones if provided
    let mut milestone_list = soroban_sdk::Vec::new(&env);
    if let Some(ms) = milestones {
        if ms.len() > 5 {
            panic!("Maximum 5 milestones allowed");
        }
        let mut total_percentage: u32 = 0;
        for (next_id, m) in (0_u32..).zip(ms.iter()) {
            if m.percentage == 0 {
                panic!("Milestone percentage must be positive");
            }
            total_percentage = total_percentage
                .checked_add(m.percentage)
                .expect("Arithmetic overflow");
            milestone_list.push_back(Milestone {
                id: next_id,
                description: m.description.clone(),
                percentage: m.percentage,
                released: false,
                rejected: false,
            });
        }
        if total_percentage != 100 {
            panic!("Milestone percentages must sum to 100");
        }
    }

    // Ensure no duplicate escrow for same job
    if env
        .storage()
        .instance()
        .has(&DataKey::Escrow(job_id.clone()))
    {
        panic!("Escrow already exists for this job");
    }

    // Transfer funds from client into the contract
    let token_client = token::Client::new(&env, &token);
    let contract_address = env.current_contract_address();
    token_client.transfer(&client, &contract_address, &amount);

    let current_ledger = env.ledger().sequence();
    let current_timestamp = env.ledger().timestamp() as u32;
    let timeout = timeout_ledgers.unwrap_or(DEFAULT_TIMEOUT_LEDGERS);
    let timeout_ledger = current_ledger
        .checked_add(timeout)
        .expect("Timeout ledger overflow");
    let timeout_seconds: u32 = env
        .storage()
        .instance()
        .get(&DataKey::DefaultTimeoutSeconds)
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let timeout_timestamp = current_timestamp
        .checked_add(timeout_seconds)
        .expect("Timeout timestamp overflow");

    // Store escrow record on-chain
    let escrow = Escrow {
        job_id: job_id.clone(),
        client: client.clone(),
        freelancer,
        token,
        amount,
        status: EscrowStatus::Locked,
        created_at: current_ledger,
        timeout_ledger,
        milestones: milestone_list,
        referrer,
        deliverable_hash,
    };

    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);
    env.storage().instance().set(
        &DataKey::TimeoutTimestamp(job_id.clone()),
        &timeout_timestamp,
    );

    // Increment counter
    let count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::EscrowCount)
        .unwrap_or(0);
    let new_count = count.checked_add(1).expect("Counter overflow");
    env.storage()
        .instance()
        .set(&DataKey::EscrowCount, &new_count);

    // Emit event
    env.events().publish(
        (symbol_short!("escrow_cr"), job_id.clone()),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            escrow.amount,
        ),
    );
}

/// Freelancer signals that they have started work.
pub(crate) fn start_work(env: Env, job_id: String, freelancer: Address) {
    freelancer.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.freelancer != freelancer {
        panic!("Only the freelancer can start work");
    }
    if escrow.status != EscrowStatus::Locked {
        panic!("Escrow is not in Locked state");
    }

    escrow.status = EscrowStatus::InProgress;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    env.events().publish(
        (symbol_short!("work_strt"), job_id.clone()),
        (escrow.client.clone(), escrow.freelancer.clone()),
    );
}

/// Client approves completed work and releases funds to the freelancer.
pub(crate) fn release_escrow(env: Env, job_id: String, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.client != client {
        panic!("Only the client can release escrow");
    }

    // Deliverable hash verification: if an expected hash was set on creation,
    // the freelancer must have submitted a matching hash before release.
    if let Some(expected_hash) = &escrow.deliverable_hash {
        let submitted: Option<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::FreelancerDeliverableHash(job_id.clone()));
        match submitted {
            Some(h) if &h == expected_hash => {}
            _ => panic!("Freelancer deliverable hash does not match or not submitted"),
        }
    }

    release_escrow_core(env, job_id, escrow);
}

pub(crate) fn release_escrow_core(env: Env, job_id: String, mut escrow: Escrow) {
    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Locked {
        panic!("Cannot release escrow in current status");
    }

    // Check if there are incomplete milestones
    let mut remaining_amount: i128 = 0;
    for ms in escrow.milestones.iter() {
        if !ms.released {
            let ms_amount = escrow
                .amount
                .checked_mul(ms.percentage as i128)
                .expect("Arithmetic overflow")
                .checked_div(100)
                .expect("Arithmetic overflow");
            remaining_amount = remaining_amount
                .checked_add(ms_amount)
                .expect("Arithmetic overflow");
        }
    }

    // If no milestones, release full amount. If milestones, release remaining.
    let release_amount = if escrow.milestones.is_empty() {
        escrow.amount
    } else {
        remaining_amount
    };

    // Mark all milestones as completed
    let mut updated_ms = soroban_sdk::Vec::new(&env);
    for mut ms in escrow.milestones.iter() {
        ms.released = true;
        updated_ms.push_back(ms);
    }
    escrow.milestones = updated_ms;

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

    escrow.status = EscrowStatus::Released;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);
    env.storage()
        .instance()
        .remove(&DataKey::TimeoutTimestamp(job_id.clone()));
    env.storage()
        .instance()
        .remove(&DataKey::FreelancerDeliverableHash(job_id.clone()));

    if release_amount > 0 {
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
        let fee_amount = release_amount
            .checked_mul(fee_bps as i128)
            .expect("Arithmetic overflow")
            .checked_div(10_000)
            .expect("Arithmetic overflow");
        let after_fee = release_amount
            .checked_sub(fee_amount)
            .expect("Arithmetic overflow");

        if fee_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
            env.events().publish(
                (symbol_short!("plat_fee"), job_id.clone()),
                (treasury.clone(), fee_amount),
            );
        }

        // ── Referral bonus: 2% of post-fee amount goes to referrer, ────────
        // capped at the admin-configured MaxReferrerBonusXlm (Issue #440).
        let (freelancer_amount, referral_amount) = match &escrow.referrer {
            Some(referrer_addr) => {
                let uncapped_bonus = after_fee
                    .checked_mul(200)
                    .expect("Arithmetic overflow")
                    .checked_div(10_000)
                    .expect("Arithmetic overflow");
                let max_bonus: Option<i128> =
                    env.storage().instance().get(&DataKey::MaxReferrerBonusXlm);
                let bonus = match max_bonus {
                    Some(cap) => uncapped_bonus.min(cap),
                    None => uncapped_bonus,
                };
                let to_freelancer = after_fee.checked_sub(bonus).expect("Arithmetic overflow");
                if bonus > 0 {
                    token_client.transfer(&env.current_contract_address(), referrer_addr, &bonus);
                    env.events().publish(
                        (symbol_short!("ref_bon"), referrer_addr.clone()),
                        (job_id.clone(), bonus),
                    );
                }
                (to_freelancer, bonus)
            }
            None => (after_fee, 0i128),
        };

        // Transfer remaining funds to freelancer
        if freelancer_amount > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.freelancer,
                &freelancer_amount,
            );
        }

        env.events().publish(
            (symbol_short!("escrow_rl"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                freelancer_amount,
                referral_amount,
                fee_amount,
            ),
        );
    } else {
        env.events().publish(
            (symbol_short!("escrow_rl"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                0i128,
                0i128,
                0i128,
            ),
        );
    }
}

/// Client approves work and releases funds WITH conversion through DEX.
/// This is used when the escrow is in one asset (e.g. USDC) but the freelancer wants another (e.g. XLM).
pub(crate) fn release_with_conversion(
    env: Env,
    job_id: String,
    client: Address,
    _target_token: Address,
    _min_amount_out: i128,
) {
    client.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.client != client {
        panic!("Only the client can release escrow");
    }
    if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Locked {
        panic!("Cannot release escrow in current status");
    }

    // Calculate remaining amount
    let mut remaining_amount: i128 = 0;
    for ms in escrow.milestones.iter() {
        if !ms.released {
            let ms_amount = escrow
                .amount
                .checked_mul(ms.percentage as i128)
                .expect("Arithmetic overflow")
                .checked_div(100)
                .expect("Arithmetic overflow");
            remaining_amount = remaining_amount
                .checked_add(ms_amount)
                .expect("Arithmetic overflow");
        }
    }
    let release_amount = if escrow.milestones.is_empty() {
        escrow.amount
    } else {
        remaining_amount
    };

    if release_amount > 0 {
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
        let fee_amount = release_amount
            .checked_mul(fee_bps as i128)
            .expect("Arithmetic overflow")
            .checked_div(10_000)
            .expect("Arithmetic overflow");
        let to_freelancer = release_amount
            .checked_sub(fee_amount)
            .expect("Arithmetic overflow");

        if fee_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &fee_amount);
        }

        // [Issue #104] Path Payment / DEX Swap
        // In a real scenario, we would call a DEX contract here.
        // For now, we simulate the conversion by transferring the source token
        // and emitting a conversion event.
        // In a real implementation with a Soroban DEX:
        // let dex = DEXClient::new(&env, &DEX_ADDRESS);
        // dex.swap(&env.current_contract_address(), &escrow.freelancer, &escrow.token, &target_token, &release_amount, &min_amount_out);

        // For this implementation, we perform the transfer and mark as converted
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &to_freelancer,
        );
    }

    // Mark all milestones as completed
    let mut updated_ms = soroban_sdk::Vec::new(&env);
    for mut ms in escrow.milestones.iter() {
        ms.released = true;
        updated_ms.push_back(ms);
    }
    escrow.milestones = updated_ms;

    // Update jobs count
    let f_jobs: u32 = env
        .storage()
        .instance()
        .get(&DataKey::CompletedJobs(escrow.freelancer.clone()))
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::CompletedJobs(escrow.freelancer.clone()),
        &(f_jobs.checked_add(1).unwrap()),
    );

    let c_jobs: u32 = env
        .storage()
        .instance()
        .get(&DataKey::CompletedJobs(escrow.client.clone()))
        .unwrap_or(0);
    env.storage().instance().set(
        &DataKey::CompletedJobs(escrow.client.clone()),
        &(c_jobs.checked_add(1).unwrap()),
    );

    escrow.status = EscrowStatus::Released;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);
    env.storage()
        .instance()
        .remove(&DataKey::TimeoutTimestamp(job_id.clone()));

    env.events().publish(
        (symbol_short!("escrow_rl"), job_id.clone()),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            release_amount,
        ),
    );
}

/// Client cancels and gets a refund (only before work starts).
pub(crate) fn refund_escrow(env: Env, job_id: String, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.client != client {
        panic!("Only the client can request a refund");
    }
    if escrow.status != EscrowStatus::Locked {
        panic!("Can only refund before work has started");
    }

    // Return funds to client
    let token_client = token::Client::new(&env, &escrow.token);
    token_client.transfer(
        &env.current_contract_address(),
        &escrow.client,
        &escrow.amount,
    );

    escrow.status = EscrowStatus::Refunded;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    env.events().publish(
        (symbol_short!("escrow_rf"), job_id.clone()),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            escrow.amount,
        ),
    );
}

/// Issue #175 — Client claims a refund if the freelancer never started work
/// before the timeout. New escrows enforce the timeout using Unix timestamps;
/// older escrows fall back to the legacy ledger-sequence threshold.
pub(crate) fn timeout_refund(env: Env, job_id: String, client: Address) {
    client.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.client != client {
        panic!("Only the client can request a timeout refund");
    }
    if escrow.status != EscrowStatus::Locked {
        panic!("Escrow is not in Locked state");
    }

    let current_timestamp = env.ledger().timestamp() as u32;
    let timeout_timestamp: Option<u32> = env
        .storage()
        .instance()
        .get(&DataKey::TimeoutTimestamp(job_id.clone()));
    let expired = if let Some(timeout_timestamp) = timeout_timestamp {
        current_timestamp >= timeout_timestamp
    } else {
        env.ledger().sequence() >= escrow.timeout_ledger
    };

    if !expired {
        panic!("Timeout period has not expired yet");
    }

    // Return funds to client
    let token_client = token::Client::new(&env, &escrow.token);
    token_client.transfer(
        &env.current_contract_address(),
        &escrow.client,
        &escrow.amount,
    );

    escrow.status = EscrowStatus::Refunded;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    env.events().publish(
        (symbol_short!("escrow_rf"), job_id.clone()),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            escrow.amount,
        ),
    );
}

pub(crate) fn request_extension(
    env: Env,
    job_id: String,
    caller: Address,
    new_timeout_ledger: u32,
) {
    caller.require_auth();

    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if caller != escrow.client && caller != escrow.freelancer {
        panic!("Only the client or freelancer can request an extension");
    }
    if escrow.status != EscrowStatus::Locked && escrow.status != EscrowStatus::InProgress {
        panic!("Cannot extend timeout in current status");
    }
    if new_timeout_ledger <= escrow.timeout_ledger {
        panic!("New timeout must be later than current timeout");
    }
    if env
        .storage()
        .instance()
        .has(&DataKey::ExtensionRequest(job_id.clone()))
    {
        panic!("An extension request is already pending for this job");
    }

    let request = ExtensionRequest {
        requested_by: caller.clone(),
        new_timeout_ledger,
        created_at: env.ledger().sequence(),
    };

    env.storage()
        .instance()
        .set(&DataKey::ExtensionRequest(job_id.clone()), &request);

    env.events().publish(
        (symbol_short!("ext_req"), job_id.clone()),
        (caller, new_timeout_ledger),
    );
}

/// The other party approves the pending extension, updating the escrow's
/// timeout_ledger and TimeoutTimestamp atomically.
pub(crate) fn approve_extension(env: Env, job_id: String, caller: Address) {
    caller.require_auth();

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.status != EscrowStatus::Locked && escrow.status != EscrowStatus::InProgress {
        panic!("Cannot extend timeout in current status");
    }

    let request: ExtensionRequest = env
        .storage()
        .instance()
        .get(&DataKey::ExtensionRequest(job_id.clone()))
        .expect("No pending extension request");

    if caller == request.requested_by {
        panic!("Cannot approve your own extension request");
    }
    if caller != escrow.client && caller != escrow.freelancer {
        panic!("Only the client or freelancer can approve an extension");
    }

    let ledger_delta = request
        .new_timeout_ledger
        .checked_sub(escrow.timeout_ledger)
        .expect("Arithmetic underflow");

    escrow.timeout_ledger = request.new_timeout_ledger;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    let current_timestamp = env.ledger().timestamp() as u32;
    let timeout_timestamp: u32 = env
        .storage()
        .instance()
        .get(&DataKey::TimeoutTimestamp(job_id.clone()))
        .unwrap_or(current_timestamp);
    let approx_seconds_per_ledger: u32 = 5;
    let timestamp_extension = ledger_delta
        .checked_mul(approx_seconds_per_ledger)
        .expect("Arithmetic overflow");
    let new_timeout_timestamp = timeout_timestamp
        .checked_add(timestamp_extension)
        .expect("Timestamp overflow");
    env.storage().instance().set(
        &DataKey::TimeoutTimestamp(job_id.clone()),
        &new_timeout_timestamp,
    );

    env.storage()
        .instance()
        .remove(&DataKey::ExtensionRequest(job_id.clone()));

    env.events().publish(
        (symbol_short!("ext_app"), job_id.clone()),
        (caller, request.requested_by, request.new_timeout_ledger),
    );
}

/// Return the pending extension request for a job, if any.
pub(crate) fn get_extension_request(env: Env, job_id: String) -> Option<ExtensionRequest> {
    env.storage()
        .instance()
        .get(&DataKey::ExtensionRequest(job_id))
}

pub(crate) fn boost_job(
    env: Env,
    job_id: String,
    client: Address,
    treasury: Address,
    token: Address,
    amount: i128,
) {
    client.require_auth();
    check_not_frozen(&env);

    if amount <= 0 {
        panic!("Boost amount must be positive");
    }

    // Minimum boost is 5 XLM (50_000_000 stroops)
    let min_boost_stroops: i128 = 50_000_000;
    if amount < min_boost_stroops {
        panic!("Minimum boost is 5 XLM");
    }

    // Transfer payment from client to treasury
    let token_client = token::Client::new(&env, &token);
    token_client.transfer(&client, &treasury, &amount);

    // Calculate boost duration in ledgers (~5 s/ledger)
    // 7 days  = 120_960 ledgers
    // 30 days = 518_400 ledgers
    let boost_ledgers: u32 = if amount >= 150_000_000 {
        518_400 // 30 days
    } else {
        120_960 // 7 days
    };

    let boost_expiry = env
        .ledger()
        .sequence()
        .checked_add(boost_ledgers)
        .expect("Boost expiry overflow");

    env.events().publish(
        (symbol_short!("boosted"), client),
        (job_id, boost_expiry, amount),
    );
}
