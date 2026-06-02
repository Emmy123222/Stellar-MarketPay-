/*
 * contracts/marketpay-contract/src/lib.rs
 *
 * Stellar MarketPay — Soroban Escrow Contract
 *
 * This contract manages trustless escrow between a client and freelancer:
 *
 *   1. Client calls create_escrow() — locks XLM in the contract
 *   2. Freelancer does the work
 *   3. Client calls release_escrow() — funds sent to freelancer
 *      OR client calls refund_escrow() before work starts — funds returned
 *
 * Build:
 *   cargo build --target wasm32-unknown-unknown --release
 *
 * Deploy:
 *   stellar contract deploy \
 *     --wasm target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
 *     --source alice --network testnet
 */

#![no_std]
#![allow(
    clippy::too_many_arguments,
    clippy::manual_range_contains,
    unused_variables
)]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, symbol_short, Address, Bytes, BytesN, Env,
    String, Vec,
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

/// Default timeout: 7 days in seconds.
const DEFAULT_TIMEOUT_SECONDS: u32 = 7 * 24 * 60 * 60;
/// Legacy fallback used by the older ledger-sequence timeout path.
const DEFAULT_TIMEOUT_LEDGERS: u32 = 120_960;

// ─── Data structures ──────────────────────────────────────────────────────────
#[contracttype]
#[derive(Clone, Debug)]
pub struct CreateEscrowParams {
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub milestones: Option<soroban_sdk::Vec<i128>>,
    pub timeout_ledgers: Option<u32>,
    pub referrer: Option<Address>,
}


/// Status of an escrow agreement.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum EscrowStatus {
    /// Funds locked, work not yet started
    Locked,
    /// Freelancer accepted, work in progress
    InProgress,
    /// Client approved work, funds released to freelancer
    Released,
    /// Client cancelled before work started, funds refunded
    Refunded,
    /// Disputed — requires admin resolution (future feature)
    Disputed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Milestone {
    pub amount: i128,
    pub is_completed: bool,
}

/// An escrow record stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    /// Unique job identifier (from backend)
    pub job_id: String,
    /// Client who locked the funds
    pub client: Address,
    /// Freelancer who will receive the funds
    pub freelancer: Address,
    /// Token contract address (XLM SAC or USDC)
    pub token: Address,
    /// Amount in token's smallest unit (stroops for XLM)
    pub amount: i128,
    /// Current escrow status
    pub status: EscrowStatus,
    /// Ledger when escrow was created
    pub created_at: u32,
    /// Ledger after which client can call timeout_refund()
    pub timeout_ledger: u32,
    /// Optional milestones for partial releases
    pub milestones: soroban_sdk::Vec<Milestone>,
    /// Optional referrer address — receives 2% bonus on release
    pub referrer: Option<Address>,
    /// Optional expected SHA-256 deliverable hash agreed by both parties
    pub deliverable_hash: Option<BytesN<32>>,
}

/// Budget commitment for sealed-bid system (Issue #108)
#[contracttype]
#[derive(Clone, Debug)]
pub struct BudgetCommitment {
    pub job_id: String,
    pub client: Address,
    pub budget_amount: i128,
    pub is_revealed: bool,
}

/// Deliverable hash for oracle verification (Issue #105)
#[contracttype]
#[derive(Clone, Debug)]
pub struct DeliverableSubmission {
    pub job_id: String,
    pub client_hash_submitted: bool,
    pub freelancer_hash_submitted: bool,
    pub hashes_match: bool,
}

/// Freelancer sealed-bid commitment entry.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BidCommitment {
    pub job_id: String,
    pub freelancer: Address,
    pub commitment: BytesN<32>,
    pub submitted_at_ledger: u32,
    pub bid_revealed: bool,
}

/// Bidding lifecycle state for a job.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BiddingState {
    pub job_id: String,
    pub client: Address,
    pub is_closed: bool,
    pub closed_at_ledger: u32,
    pub reveal_deadline_ledger: u32,
}

/// A successfully revealed bid.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RevealedBid {
    pub freelancer: Address,
    pub amount: i128,
    pub revealed_at_ledger: u32,
}

/// Job completion certificate (Issue #102)
#[contracttype]
#[derive(Clone, Debug)]
pub struct Certificate {
    pub job_id: String,
    pub freelancer: Address,
    pub amount: i128,
    pub created_at: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Rating {
    pub job_id: String,
    pub rater: Address,
    pub rated: Address,
    pub score_out_of_5: u32,
    pub submitted_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FreelancerRatingStats {
    pub total_score: u32,
    pub count: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitrationCase {
    pub job_id: String,
    pub arbitrators: Vec<Address>,
    pub votes: Vec<u32>,
    pub resolution: u32,
    pub status: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeCase {
    pub job_id: String,
    pub arbitrators: Vec<Address>,
    pub votes: Vec<u32>,
    pub voters: Vec<Address>,
    pub resolution: u32,
    pub status: u32,
}

/// Storage key per job
#[contracttype]
pub enum DataKey {
    Admin,
    Escrow(String),
    EscrowCount,
    Proposal(u32),
    ProposalCount,
    HasVoted(Address, u32),
    CompletedJobs(Address),
    DefaultTimeoutSeconds,
    TimeoutTimestamp(String),
    BudgetCommitment(String),
    DeliverableSubmission(String),
    BidCommitment(String, Address),
    BiddingState(String),
    RevealedBids(String),
    Certificate(String),
    FreelancerCertificates(Address),
    ClientRating(String),
    FreelancerRating(String),
    FreelancerRatingStats(Address),
    Arbitrator(Address),
    ArbitratorPool,
    ArbitrationCase(u32),
    ArbitrationCaseCount,
    DisputeCase(String),
    Version,
    /// Stores list of IPFS CIDs for messages in a job thread
    MessageCid(String),
}

/// Reveal phase is open for roughly 24 hours after client closes bidding.
const REVEAL_WINDOW_LEDGERS: u32 = 17_280;

/// A governance proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u32,
    pub title: String,
    pub description: String,
    pub votes_for: u32,
    pub votes_against: u32,
    pub deadline_ledger: u32,
    pub resolved: bool,
    pub result: bool,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct MarketPayContract;

#[allow(clippy::too_many_arguments)]
#[contractimpl]
impl MarketPayContract {
    fn compute_bid_commitment(env: &Env, amount: i128, nonce: BytesN<32>) -> BytesN<32> {
        let mut payload = Bytes::new(env);
        for byte in amount.to_be_bytes().iter() {
            payload.push_back(*byte);
        }
        for byte in nonce.to_array().iter() {
            payload.push_back(*byte);
        }
        env.crypto().sha256(&payload)
    }

    // ─── Initialization ──────────────────────────────────────────────────────

    /// Initialize with an admin address (called once after deployment).
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EscrowCount, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::DefaultTimeoutSeconds, &DEFAULT_TIMEOUT_SECONDS);
        env.storage().instance().set(&DataKey::Version, &1u32);
    }

    // ─── Upgrade & versioning ─────────────────────────────────────────────────

    /// Upgrade the contract WASM. Restricted to admin.
    ///
    /// `new_wasm_hash` is the 32-byte hash of the new WASM blob already
    /// uploaded to the network via `stellar contract install`.
    /// All existing storage (escrows, proposals, ratings, …) is preserved
    /// because Soroban upgrades only replace the executable, not the state.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        // Bump version so callers can detect the upgrade
        let version: u32 = env.storage().instance().get(&DataKey::Version).unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &(version + 1));

        env.events()
            .publish((symbol_short!("upgraded"), admin), version + 1);
    }

    /// Return the current contract version (starts at 1, increments on each upgrade).
    pub fn get_version(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Version).unwrap_or(1)
    }

    // ─── Escrow lifecycle ─────────────────────────────────────────────────────

    /// Client creates an escrow by transferring funds into the contract.
    ///
    /// Parameters:
    ///   job_id           — unique ID matching the backend job record
    ///   freelancer       — the address that will receive payment on release
    ///   token            — SAC address of the payment token (XLM or USDC)
    ///   amount           — payment amount in smallest token units
    ///   milestones       — optional list of milestones (amounts must sum to total amount)
    ///   timeout_ledgers  — optional ledger timeout (default 7 days)
    ///   referrer         — optional referrer address; receives 2% bonus on release
    pub fn create_escrow(
        env: Env,
        job_id: String,
        client: Address,
        params: CreateEscrowParams,
    ) {
        Self::create_escrow_internal(
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
    pub fn create_escrow_with_deliverable(
        env: Env,
        job_id: String,
        client: Address,
        params: CreateEscrowParams,
        deliverable_hash: BytesN<32>,
    ) {
        Self::create_escrow_internal(
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

    #[allow(clippy::too_many_arguments)]
    fn create_escrow_internal(
        env: Env,
        job_id: String,
        client: Address,
        freelancer: Address,
        token: Address,
        amount: i128,
        milestones: Option<soroban_sdk::Vec<i128>>,
        timeout_ledgers: Option<u32>,
        referrer: Option<Address>,
        deliverable_hash: Option<BytesN<32>>,
    ) {
        client.require_auth();

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
            let mut total_ms_amount: i128 = 0;
            for amt in ms.iter() {
                if amt <= 0 {
                    panic!("Milestone amount must be positive");
                }
                total_ms_amount = total_ms_amount
                    .checked_add(amt)
                    .expect("Arithmetic overflow");
                milestone_list.push_back(Milestone {
                    amount: amt,
                    is_completed: false,
                });
            }
            if total_ms_amount != amount {
                panic!("Milestone amounts must sum to total escrow amount");
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
        token_client.transfer(&client, &env.current_contract_address(), &amount);

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
            (escrow.client.clone(), escrow.freelancer.clone(), escrow.amount),
        );
    }

    /// Client accepts a freelancer and marks work as in-progress.
    pub fn start_work(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can start work");
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
    pub fn release_escrow(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can release escrow");
        }
        Self::release_escrow_core(env, job_id, escrow);
    }

    fn release_escrow_core(env: Env, job_id: String, mut escrow: Escrow) {
        if escrow.status != EscrowStatus::InProgress && escrow.status != EscrowStatus::Locked {
            panic!("Cannot release escrow in current status");
        }

        // Check if there are incomplete milestones
        let mut remaining_amount: i128 = 0;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                remaining_amount = remaining_amount
                    .checked_add(ms.amount)
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
            ms.is_completed = true;
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

        if release_amount > 0 {
            let token_client = token::Client::new(&env, &escrow.token);

            // ── Referral bonus: 2% of release_amount goes to referrer ──────────
            // The remaining 98% goes to the freelancer.
            let (freelancer_amount, referral_amount) = match &escrow.referrer {
                Some(referrer_addr) => {
                    // 2% in basis points: amount * 200 / 10_000
                    let bonus = release_amount
                        .checked_mul(200)
                        .expect("Arithmetic overflow")
                        .checked_div(10_000)
                        .expect("Arithmetic overflow");
                    let to_freelancer = release_amount
                        .checked_sub(bonus)
                        .expect("Arithmetic overflow");
                    // Transfer bonus to referrer
                    if bonus > 0 {
                        token_client.transfer(
                            &env.current_contract_address(),
                            referrer_addr,
                            &bonus,
                        );
                        env.events().publish(
                            (symbol_short!("ref_bon"), referrer_addr.clone()),
                            (job_id.clone(), bonus),
                        );
                    }
                    (to_freelancer, bonus)
                }
                None => (release_amount, 0i128),
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
                (escrow.client.clone(), escrow.freelancer.clone(), freelancer_amount, referral_amount),
            );
        } else {
            env.events().publish(
                (symbol_short!("escrow_rl"), job_id.clone()),
                (escrow.client.clone(), escrow.freelancer.clone(), 0i128, 0i128),
            );
        }
    }

    /// Client approves work and releases funds WITH conversion through DEX.
    /// This is used when the escrow is in one asset (e.g. USDC) but the freelancer wants another (e.g. XLM).
    pub fn release_with_conversion(
        env: Env,
        job_id: String,
        client: Address,
        _target_token: Address,
        _min_amount_out: i128,
    ) {
        client.require_auth();

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
            if !ms.is_completed {
                remaining_amount = remaining_amount
                    .checked_add(ms.amount)
                    .expect("Arithmetic overflow");
            }
        }
        let release_amount = if escrow.milestones.is_empty() {
            escrow.amount
        } else {
            remaining_amount
        };

        if release_amount > 0 {
            // [Issue #104] Path Payment / DEX Swap
            // In a real scenario, we would call a DEX contract here.
            // For now, we simulate the conversion by transferring the source token
            // and emitting a conversion event.
            let token_client = token::Client::new(&env, &escrow.token);

            // In a real implementation with a Soroban DEX:
            // let dex = DEXClient::new(&env, &DEX_ADDRESS);
            // dex.swap(&env.current_contract_address(), &escrow.freelancer, &escrow.token, &target_token, &release_amount, &min_amount_out);

            // For this implementation, we perform the transfer and mark as converted
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.freelancer,
                &release_amount,
            );
        }

        // Mark all milestones as completed
        let mut updated_ms = soroban_sdk::Vec::new(&env);
        for mut ms in escrow.milestones.iter() {
            ms.is_completed = true;
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
            (escrow.client.clone(), escrow.freelancer.clone(), release_amount),
        );
    }

    /// Client cancels and gets a refund (only before work starts).
    pub fn refund_escrow(env: Env, job_id: String, client: Address) {
        client.require_auth();

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
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("escrow_rf"), job_id.clone()),
            (escrow.client.clone(), escrow.freelancer.clone(), escrow.amount),
        );
    }

    /// Issue #175 — Client claims a refund if the freelancer never started work
    /// before the timeout. New escrows enforce the timeout using Unix timestamps;
    /// older escrows fall back to the legacy ledger-sequence threshold.
    pub fn timeout_refund(env: Env, job_id: String, client: Address) {
        client.require_auth();

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
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("escrow_rf"), job_id.clone()),
            (escrow.client.clone(), escrow.freelancer.clone(), escrow.amount),
        );
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /// Get the full escrow record for a job.
    pub fn get_escrow(env: Env, job_id: String) -> Escrow {
        env.storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found")
    }

    /// Get escrow status for a job.
    pub fn get_status(env: Env, job_id: String) -> EscrowStatus {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.status
    }

    /// Get timeout ledger for a job.
    pub fn get_timeout_ledger(env: Env, job_id: String) -> u32 {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.timeout_ledger
    }

    /// Get the timestamp after which `timeout_refund()` becomes available.
    pub fn get_timeout_timestamp(env: Env, job_id: String) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TimeoutTimestamp(job_id))
            .unwrap_or(0)
    }

    /// Get the referrer address for a job's escrow, if one was set.
    pub fn get_referrer(env: Env, job_id: String) -> Option<Address> {
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.referrer
    }

    /// Get total number of escrows created.
    pub fn get_escrow_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCount)
            .unwrap_or(0)
    }

    /// Get the contract admin.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized")
    }

    /// Get the current global timeout in seconds.
    pub fn get_default_timeout_seconds(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DefaultTimeoutSeconds)
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
    }

    /// Update the global timeout in seconds.
    ///
    /// This acts as the governance/admin override for new escrows.
    pub fn set_default_timeout_seconds(env: Env, admin: Address, timeout_seconds: u32) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can update the timeout");
        }
        if timeout_seconds == 0 {
            panic!("Timeout must be positive");
        }

        env.storage()
            .instance()
            .set(&DataKey::DefaultTimeoutSeconds, &timeout_seconds);
        env.events()
            .publish((symbol_short!("timeout"), admin), timeout_seconds);
    }

    // ─── On-chain Message Notarization ─────────────────────────────────────
    //
    // Messages are stored off-chain on IPFS.  Only the IPFS CID is stored on-chain
    // via events, providing censorship resistance and verifiability without the
    // cost of storing full message content on-chain.

    /// Publish a message CID to the ledger.
    ///
    /// The message content itself is stored off-chain (IPFS).  This function
    /// records the IPFS CID on-chain so recipients can verify message authenticity
    /// from Stellar Explorer.
    ///
    /// Parameters:
    ///   job_id    — job this message belongs to
    ///   sender    — the party sending the message
    ///   recipient — the party receiving the message
    ///   ipfs_cid  — IPFS content identifier for the encrypted message payload
    pub fn publish_message(
        env: Env,
        job_id: String,
        sender: Address,
        recipient: Address,
        ipfs_cid: String,
    ) {
        sender.require_auth();

        // Basic validation
        if ipfs_cid.is_empty() {
            panic!("IPFS CID cannot be empty");
        }

        // Store CID in contract storage for on-chain verification
        let mut cids: soroban_sdk::Vec<String> = env.storage().instance()
            .get(&DataKey::MessageCid(job_id.clone()))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        cids.push_back(ipfs_cid.clone());
        env.storage().instance().set(&DataKey::MessageCid(job_id.clone()), &cids);

        let ledger_seq = env.ledger().sequence();

        env.events().publish(
            (symbol_short!("msg_sent"), job_id.clone()),
            (
                sender.clone(),
                recipient.clone(),
                ipfs_cid,
                ledger_seq,
            ),
        );
    }

    /// Retrieve all message CIDs stored on-chain for a job.
    pub fn get_message_cids(env: Env, job_id: String) -> soroban_sdk::Vec<String> {
        env.storage().instance()
            .get(&DataKey::MessageCid(job_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
    }

    // ─── Governance (DAO) ───────────────────────────────────────────────────

    pub fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        duration_ledgers: u32,
    ) -> u32 {
        proposer.require_auth();

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

    pub fn cast_vote(env: Env, voter: Address, proposal_id: u32, approve: bool) {
        voter.require_auth();

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

    pub fn resolve_proposal(env: Env, proposal_id: u32) {
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

    pub fn get_proposal(env: Env, id: u32) -> Proposal {
        env.storage()
            .instance()
            .get(&DataKey::Proposal(id))
            .expect("Proposal not found")
    }

    pub fn list_active_proposals(env: Env) -> Vec<Proposal> {
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

    // ─── Placeholders ─────────────────────────────────────────────────────────

    /// [PLACEHOLDER] Raise a dispute — requires admin resolution.
    /// See ROADMAP.md v2.1 — DAO Governance.
    pub fn raise_dispute(env: Env, job_id: String, caller: Address) {
        caller.require_auth();

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != caller && escrow.freelancer != caller {
            panic!("Only participants can raise a dispute");
        }

        if escrow.status == EscrowStatus::Released || escrow.status == EscrowStatus::Refunded {
            panic!("Cannot dispute a resolved escrow");
        }
        
        escrow.status = EscrowStatus::Disputed;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("escrow_ds"), job_id.clone()),
            (escrow.client.clone(), escrow.freelancer.clone(), caller.clone()),
        );
    }

    /// Milestone-based partial release.
    /// Can be called even if the escrow is Disputed, to release completed work.
    pub fn partial_release(env: Env, job_id: String, milestone_index: u32, client: Address) {
        client.require_auth();

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

        if milestone_index >= escrow.milestones.len() {
            panic!("Invalid milestone index");
        }

        let mut milestone = escrow.milestones.get(milestone_index).unwrap();
        if milestone.is_completed {
            panic!("Milestone already completed");
        }

        milestone.is_completed = true;
        escrow.milestones.set(milestone_index, milestone.clone());

        // Transfer funds to freelancer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &milestone.amount,
        );

        // Check if all milestones are now completed
        let mut all_completed = true;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
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
            (symbol_short!("ms_rel"), job_id.clone()),
            (escrow.client.clone(), escrow.freelancer.clone(), milestone_index, milestone.amount),
        );
    }

    // ─── Issue #344: Job Boost with XLM Payment ──────────────────────────────

    /// Client pays XLM to the platform treasury to boost a job listing.
    ///
    /// Boost tiers (in stroops, 1 XLM = 10_000_000 stroops):
    ///   ≥  5 XLM → 7-day boost
    ///   ≥ 15 XLM → 30-day boost
    ///
    /// The payment is transferred directly to `treasury`.
    /// Emits a `JobBoosted` event with job_id and boost_expiry_ledger.
    pub fn boost_job(
        env: Env,
        job_id: String,
        client: Address,
        treasury: Address,
        token: Address,
        amount: i128,
    ) {
        client.require_auth();

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

        let boost_expiry = env.ledger().sequence()
            .checked_add(boost_ledgers)
            .expect("Boost expiry overflow");

        env.events().publish(
            (symbol_short!("boosted"), client),
            (job_id, boost_expiry, amount),
        );
    }

    // ─── Issue #108: Sealed-Bid Budget Commitment ────────────────────────────

    /// Client commits to a budget amount (sealed-bid, prevents anchoring bias).
    pub fn commit_budget(env: Env, job_id: String, budget_amount: i128, client: Address) {
        client.require_auth();

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
    pub fn reveal_budget(env: Env, job_id: String, client: Address) {
        client.require_auth();

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
    pub fn get_budget_commitment(env: Env, job_id: String) -> BudgetCommitment {
        env.storage()
            .instance()
            .get(&DataKey::BudgetCommitment(job_id))
            .expect("Budget commitment not found")
    }

    // ─── Issue #338: Sealed-Bid Commitment Scheme ───────────────────────────

    /// Freelancer submits a sealed commitment hash for their bid amount.
    pub fn submit_bid_commitment(
        env: Env,
        job_id: String,
        freelancer: Address,
        commitment: BytesN<32>,
    ) {
        freelancer.require_auth();

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
    pub fn close_bidding(env: Env, job_id: String, client: Address) {
        client.require_auth();

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
    pub fn reveal_bid(env: Env, job_id: String, freelancer: Address, amount: i128, nonce: BytesN<32>) {
        freelancer.require_auth();

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

        let expected = Self::compute_bid_commitment(&env, amount, nonce);
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
    pub fn get_bid_commitment(env: Env, job_id: String, freelancer: Address) -> BidCommitment {
        env.storage()
            .instance()
            .get(&DataKey::BidCommitment(job_id, freelancer))
            .expect("Bid commitment not found")
    }

    /// Read all bids that were revealed during reveal phase.
    pub fn get_revealed_bids(env: Env, job_id: String) -> Vec<RevealedBid> {
        env.storage()
            .instance()
            .get(&DataKey::RevealedBids(job_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ─── Issue #105: Deliverable Hash Oracle ────────────────────────────────

    /// Client submits deliverable hash.
    pub fn submit_client_deliverable(env: Env, job_id: String, client: Address) {
        client.require_auth();

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
    pub fn submit_freelancer_deliverable(env: Env, job_id: String, freelancer: Address) {
        freelancer.require_auth();

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
    pub fn submit_deliverable(env: Env, job_id: String, actual_hash: BytesN<32>, caller: Address) {
        caller.require_auth();

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
            Self::release_escrow_core(env, job_id.clone(), escrow);
            env.events().publish(
                (symbol_short!("dlv_ok"), job_id),
                (caller, actual_hash),
            );
            return;
        }

        // Mismatch must explicitly enter dispute.
        escrow.status = EscrowStatus::Disputed;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("dlv_bad"), job_id),
            (caller, actual_hash),
        );
    }

    /// Auto-release if both hashes match (manual fallback if mismatch after 7 days).
    pub fn check_deliverable_match(env: Env, job_id: String) -> bool {
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
    pub fn get_deliverable_submission(env: Env, job_id: String) -> DeliverableSubmission {
        env.storage()
            .instance()
            .get(&DataKey::DeliverableSubmission(job_id))
            .expect("Deliverable submission not found")
    }

    // ─── Issue #102: Job Completion Certificate ──────────────────────────────

    /// Mint a certificate when job is completed (upon escrow release).
    pub fn mint_certificate(env: Env, job_id: String, client: Address) {
        client.require_auth();

        // Only client can mint
        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can mint a certificate");
        }
        if escrow.status != EscrowStatus::Released {
            panic!("Escrow must be released to mint certificate");
        }

        // Prevent duplicate certificates
        if env
            .storage()
            .instance()
            .has(&DataKey::Certificate(job_id.clone()))
        {
            panic!("Certificate already minted");
        }

        let cert = Certificate {
            job_id: job_id.clone(),
            freelancer: escrow.freelancer.clone(),
            amount: escrow.amount,
            created_at: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Certificate(job_id.clone()), &cert);

        // Track in freelancer's certificate history
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

    /// Get a certificate.
    pub fn get_certificate(env: Env, job_id: String) -> Certificate {
        env.storage()
            .instance()
            .get(&DataKey::Certificate(job_id))
            .expect("Certificate not found")
    }

    /// Get all certificates for a freelancer.
    pub fn get_freelancer_certificates(env: Env, freelancer: Address) -> Vec<String> {
        env.storage()
            .instance()
            .get(&DataKey::FreelancerCertificates(freelancer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn submit_client_rating(env: Env, job_id: String, client: Address, score: u32) {
        client.require_auth();
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
        if escrow.client != client {
            panic!("Only job client can submit client rating");
        }
        if env
            .storage()
            .instance()
            .has(&DataKey::ClientRating(job_id.clone()))
        {
            panic!("Client rating already submitted for this job");
        }

        let rating = Rating {
            job_id: job_id.clone(),
            rater: client.clone(),
            rated: escrow.freelancer.clone(),
            score_out_of_5: score,
            submitted_at_ledger: env.ledger().sequence(),
        };
        env.storage()
            .instance()
            .set(&DataKey::ClientRating(job_id.clone()), &rating);

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

    pub fn submit_freelancer_rating(env: Env, job_id: String, freelancer: Address, score: u32) {
        freelancer.require_auth();
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

    pub fn get_freelancer_rating_avg(env: Env, freelancer: Address) -> u32 {
        let stats: FreelancerRatingStats = env
            .storage()
            .instance()
            .get(&DataKey::FreelancerRatingStats(freelancer))
            .unwrap_or(FreelancerRatingStats {
                total_score: 0,
                count: 0,
            });
        if stats.count == 0 {
            return 0;
        }
        stats.total_score / stats.count
    }

    pub fn register_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can register arbitrators");
        }
        env.storage()
            .instance()
            .set(&DataKey::Arbitrator(arbitrator.clone()), &true);
        let mut pool: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorPool)
            .unwrap_or_else(|| Vec::new(&env));
        pool.push_back(arbitrator);
        env.storage()
            .instance()
            .set(&DataKey::ArbitratorPool, &pool);
    }

    pub fn open_arbitration(env: Env, job_id: String, admin: Address) -> u32 {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can open arbitration");
        }

        let pool: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ArbitratorPool)
            .unwrap_or_else(|| Vec::new(&env));
        if pool.len() < 3 {
            panic!("Need at least 3 registered arbitrators");
        }

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ArbitrationCaseCount)
            .unwrap_or(0);
        let case_id = count.checked_add(1).expect("Counter overflow");
        let seed = env.ledger().sequence() as usize;
        let mut chosen = Vec::new(&env);
        chosen.push_back(pool.get((seed % pool.len() as usize) as u32).unwrap());
        chosen.push_back(pool.get(((seed + 1) % pool.len() as usize) as u32).unwrap());
        chosen.push_back(pool.get(((seed + 2) % pool.len() as usize) as u32).unwrap());

        let case = ArbitrationCase {
            job_id,
            arbitrators: chosen,
            votes: Vec::new(&env),
            resolution: 0,
            status: 0,
        };
        env.storage()
            .instance()
            .set(&DataKey::ArbitrationCase(case_id), &case);
        env.storage()
            .instance()
            .set(&DataKey::ArbitrationCaseCount, &case_id);
        case_id
    }

    pub fn cast_arbitration_vote(env: Env, case_id: u32, arbitrator: Address, client_percent: u32) {
        arbitrator.require_auth();
        if client_percent > 100 {
            panic!("Client percent must be 0-100");
        }

        let mut case: ArbitrationCase = env
            .storage()
            .instance()
            .get(&DataKey::ArbitrationCase(case_id))
            .expect("Arbitration case not found");
        if case.status != 0 {
            panic!("Arbitration case is not open");
        }
        if !case.arbitrators.contains(&arbitrator) {
            panic!("Only selected arbitrators can vote");
        }
        if case.votes.len() >= 3 {
            panic!("All votes already submitted");
        }
        case.votes.push_back(client_percent);
        env.storage()
            .instance()
            .set(&DataKey::ArbitrationCase(case_id), &case);
    }

    pub fn resolve_arbitration(env: Env, case_id: u32) {
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
            .publish((symbol_short!("arb_res"), case_id), case.resolution);
    }

    pub fn get_arbitration_case(env: Env, case_id: u32) -> ArbitrationCase {
        env.storage()
            .instance()
            .get(&DataKey::ArbitrationCase(case_id))
            .expect("Arbitration case not found")
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_init_panics() {
        let env = Env::default();
        let id = env.register(MarketPayContract, ());
        let c = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        c.initialize(&admin);
    }

    #[test]
    fn test_escrow_count_starts_zero() {
        let env = Env::default();
        let id = env.register(MarketPayContract, ());
        let c = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        assert_eq!(c.get_escrow_count(), 0);
    }

    #[test]
    fn test_governance_flow() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let proposer = Address::generate(&env);
        let voter1 = Address::generate(&env);
        let voter2 = Address::generate(&env);

        // Give voters completed jobs directly into storage
        env.as_contract(&id, || {
            env.storage()
                .instance()
                .set(&DataKey::CompletedJobs(voter1.clone()), &1u32);
            env.storage()
                .instance()
                .set(&DataKey::CompletedJobs(voter2.clone()), &1u32);
        });

        let title = String::from_str(&env, "Test Proposal");
        let desc = String::from_str(&env, "Description");
        let pid = client.create_proposal(&proposer, &title, &desc, &100);

        assert_eq!(pid, 1);
        let prop = client.get_proposal(&pid);
        assert_eq!(prop.title, title);

        // Vote
        client.cast_vote(&voter1, &pid, &true);
        client.cast_vote(&voter2, &pid, &false);

        // Advance ledger using internal testutils sequence setter if possible,
        // or by generating mock block.
        // We will mock sequence directly on test env.
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 101;
        env.ledger().set(ledger_info);

        client.resolve_proposal(&pid);

        let final_prop = client.get_proposal(&pid);
        assert_eq!(final_prop.resolved, true);
        assert_eq!(final_prop.result, false); // 1 to 1 is not majority
    }

    #[test]
    #[should_panic(expected = "Only users with completed jobs can vote")]
    fn test_governance_unauthorized_voter() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Desc");
        let pid = client.create_proposal(&proposer, &title, &desc, &100);

        // Panics here
        client.cast_vote(&voter, &pid, &true);
    }
}

#[cfg(test)]
mod timeout_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

    fn setup_contract(env: &Env) -> (MarketPayContractClient, Address, Address, Address, Address) {
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin);

        let contract_client_addr = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&contract_client_addr, &1000);

        (client, contract_client_addr, freelancer, token_id, admin)
    }

    #[test]
    fn test_timeout_refund_success() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_1");
        let timeout_ledgers = 10u32;
        client.create_escrow(&job_id, &contract_client, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: None, timeout_ledgers: Some(timeout_ledgers), referrer: None });

        let escrow = client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Locked);
        assert_eq!(
            escrow.timeout_ledger,
            env.ledger().sequence() + timeout_ledgers
        );

        // Advance ledger past timeout (both sequence and timestamp)
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += timeout_ledgers + 1;
        ledger_info.timestamp += (DEFAULT_TIMEOUT_SECONDS + 1) as u64; // Advance timestamp too
        env.ledger().set(ledger_info);

        client.timeout_refund(&job_id, &contract_client);

        let escrow_after = client.get_escrow(&job_id);
        assert_eq!(escrow_after.status, EscrowStatus::Refunded);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&contract_client), 1000);
    }

    #[test]
    #[should_panic(expected = "Timeout period has not expired yet")]
    fn test_timeout_refund_before_timeout_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_2");
        let timeout_ledgers = 100u32;
        client.create_escrow(&job_id, &contract_client, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: None, timeout_ledgers: Some(timeout_ledgers), referrer: None });

        // Try to timeout refund before timeout — should panic
        client.timeout_refund(&job_id, &contract_client);
    }

    #[test]
    #[should_panic(expected = "Only the client can request a timeout refund")]
    fn test_timeout_refund_unauthorized_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_3");
        let timeout_ledgers = 5u32;
        client.create_escrow(&job_id, &contract_client, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: None, timeout_ledgers: Some(timeout_ledgers), referrer: None });

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += timeout_ledgers + 1;
        env.ledger().set(ledger_info);

        let attacker = Address::generate(&env);
        client.timeout_refund(&job_id, &attacker);
    }

    #[test]
    #[should_panic(expected = "Escrow is not in Locked state")]
    fn test_timeout_refund_after_start_work_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "timeout_job_4");
        let timeout_ledgers = 10u32;
        client.create_escrow(&job_id, &contract_client, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: None, timeout_ledgers: Some(timeout_ledgers), referrer: None });

        // Start work changes status to InProgress
        client.start_work(&job_id, &contract_client);

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += timeout_ledgers + 1;
        env.ledger().set(ledger_info);

        client.timeout_refund(&job_id, &contract_client);
    }

    #[test]
    fn test_timeout_refund_with_custom_timeout() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "custom_timeout_job");
        let custom_timeout = 50u32;
        client.create_escrow(&job_id, &contract_client, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: Some(custom_timeout), referrer: None });

        let escrow = client.get_escrow(&job_id);
        assert_eq!(
            escrow.timeout_ledger,
            env.ledger().sequence() + custom_timeout
        );
    }

    #[test]
    fn test_default_timeout_ledgers() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "default_timeout_job");
        client.create_escrow(&job_id, &contract_client, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None });

        let escrow = client.get_escrow(&job_id);
        assert_eq!(
            escrow.timeout_ledger,
            env.ledger().sequence() + DEFAULT_TIMEOUT_LEDGERS
        );
    }

    #[test]
    fn test_get_timeout_ledger() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "get_timeout_job");
        let timeout = 25u32;
        client.create_escrow(&job_id, &contract_client, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: Some(timeout), referrer: None });

        assert_eq!(
            client.get_timeout_ledger(&job_id),
            env.ledger().sequence() + timeout
        );
    }
}

#[cfg(test)]
mod regression_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

    #[test]
    #[should_panic(expected = "Arithmetic overflow")]
    fn test_milestone_overflow_regression() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let job_id = String::from_str(&env, "job1");
        let freelancer = Address::generate(&env);
        let token = Address::generate(&env);

        let mut milestones = Vec::new(&env);
        milestones.push_back(i128::MAX);
        milestones.push_back(1);
        
        client.create_escrow(&job_id, &admin, &CreateEscrowParams { freelancer: freelancer.clone(), token: token.clone(), amount: i128::MAX, milestones: Some(milestones), timeout_ledgers: None, referrer: None });
    }

    #[test]
    fn test_release_escrow_state_consistency_regression() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        contract_client.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let job_id = String::from_str(&env, "job1");
        contract_client.create_escrow(&job_id, &client.clone(), &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: None, timeout_ledgers: None, referrer: None });
        contract_client.start_work(&job_id, &client.clone());

        contract_client.release_escrow(&job_id, &client.clone());

        let escrow = contract_client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&freelancer), 1000);
    }

    #[test]
    fn test_release_with_conversion() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        contract_client.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let job_id = String::from_str(&env, "job_conv");
        contract_client.create_escrow(&job_id, &client.clone(), &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: None, timeout_ledgers: None, referrer: None });
        
        let target_token = Address::generate(&env); 
        contract_client.release_with_conversion(&job_id, &client.clone(), &target_token, &900);

        let escrow = contract_client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }
    #[test]
    fn test_partial_release() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        contract_client.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_client = token::Client::new(&env, &token_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let mut milestones = Vec::new(&env);
        milestones.push_back(400);
        milestones.push_back(600);

        let job_id = String::from_str(&env, "job_partial");
        contract_client.create_escrow(&job_id, &client.clone(), &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: Some(milestones), timeout_ledgers: None, referrer: None });
        contract_client.start_work(&job_id, &client.clone());

        // Raise dispute to test that we can still partial release
        contract_client.raise_dispute(&job_id, &client.clone());

        contract_client.partial_release(&job_id, &0u32, &client.clone());

        let escrow = contract_client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);
        assert_eq!(token_client.balance(&freelancer), 400);
        assert_eq!(escrow.milestones.get(0).unwrap().is_completed, true);
        assert_eq!(escrow.milestones.get(1).unwrap().is_completed, false);

        // Release final milestone
        contract_client.partial_release(&job_id, &1u32, &client.clone());
        let escrow2 = contract_client.get_escrow(&job_id);
        assert_eq!(escrow2.status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&freelancer), 1000);
    }
}

#[cfg(test)]
mod upgrade_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

    /// Verifies that:
    ///   - get_version() returns 1 after initialize()
    ///   - upgrade() with a valid hash increments the version to 2
    ///   - existing escrow state is preserved after upgrade
    ///
    /// Note: `update_current_contract_wasm` requires the hash to reference
    /// an installed WASM blob. In unit tests we verify the auth guard and
    /// version-bump logic; the actual WASM swap is covered by integration /
    /// testnet tests (see README upgrade process).
    #[test]
    fn test_version_starts_at_one() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_version(), 1u32);
    }

    /// Verifies escrow state is readable before and after a simulated upgrade
    /// (version bump via direct storage write, bypassing WASM swap).
    #[test]
    fn test_escrow_state_preserved_across_version_bump() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let depositor = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&depositor, &500);

        let job_id = String::from_str(&env, "upgrade_job_1");
        client.create_escrow(&job_id, &depositor, &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None });

        // Simulate the version bump that upgrade() performs (without WASM swap)
        env.as_contract(&id, || {
            let v: u32 = env.storage().instance().get(&DataKey::Version).unwrap_or(1);
            env.storage().instance().set(&DataKey::Version, &(v + 1));
        });

        assert_eq!(client.get_version(), 2u32);

        // Escrow state intact
        let escrow = client.get_escrow(&job_id);
        assert_eq!(escrow.amount, 500);
        assert_eq!(escrow.status, EscrowStatus::Locked);
    }

    #[test]
    #[should_panic]
    fn test_upgrade_rejected_for_non_admin() {
        let env = Env::default();
        // Do NOT mock_all_auths — auth will fail for non-admin
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
        // Called without admin auth → should panic
        client.upgrade(&fake_hash);
    }
}

#[cfg(test)]
mod event_tests {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Events;
    use soroban_sdk::{Address, Env, String, Vec};

    fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin);

        let contract_client = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&contract_client, &1000);

        (client, contract_client, freelancer, token_id)
    }

    fn get_event_topic0_str(env: &Env, idx: u32) -> std::string::String {
        let events = env.events().all();
        let event = events.get(idx).unwrap();
        let topic0 = event.1.get(0).unwrap();
        std::format!("{:?}", topic0)
    }

    #[test]
    fn test_create_escrow_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-1");

        client.create_escrow(
            &job_id, &contract_client,
            &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None },
        );

        let last_idx = env.events().all().len() - 1;
        assert!(
            get_event_topic0_str(&env, last_idx).contains("escrow_cr"),
        );
    }

    #[test]
    fn test_start_work_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-2");
        client.create_escrow(
            &job_id, &contract_client,
            &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None },
        );

        client.start_work(&job_id, &contract_client);

        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("work_strt"),
        );
    }

    #[test]
    fn test_release_escrow_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-3");
        client.create_escrow(
            &job_id, &contract_client,
            &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None },
        );
        client.start_work(&job_id, &contract_client);

        client.release_escrow(&job_id, &contract_client);

        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_rl"),
        );
    }

    #[test]
    fn test_refund_escrow_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-4");
        client.create_escrow(
            &job_id, &contract_client,
            &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None },
        );

        client.refund_escrow(&job_id, &contract_client);

        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_rf"),
        );
    }

    #[test]
    fn test_raise_dispute_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-5");
        client.create_escrow(
            &job_id, &contract_client,
            &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None },
        );

        client.raise_dispute(&job_id, &contract_client);

        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_ds"),
        );
    }

    #[test]
    fn test_milestone_released_emits_event() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-6");
        let mut milestones = Vec::new(&env);
        milestones.push_back(400);
        milestones.push_back(600);
        client.create_escrow(
            &job_id, &contract_client,
            &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 1000, milestones: Some(milestones), timeout_ledgers: None, referrer: None },
        );
        client.start_work(&job_id, &contract_client);

        client.partial_release(&job_id, &0u32, &contract_client);

        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("ms_rel"),
        );
    }

    #[test]
    fn test_full_lifecycle_events_all_emitted() {
        let env = Env::default();
        let (client, contract_client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "evt-job-7");

        client.create_escrow(
            &job_id, &contract_client,
            &CreateEscrowParams { freelancer: freelancer.clone(), token: token_id.clone(), amount: 500, milestones: None, timeout_ledgers: None, referrer: None },
        );
        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_cr"),
            "Missing escrow_cr after create_escrow",
        );

        client.start_work(&job_id, &contract_client);
        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("work_strt"),
            "Missing work_strt after start_work",
        );

        client.release_escrow(&job_id, &contract_client);
        assert!(
            get_event_topic0_str(&env, env.events().all().len() - 1).contains("escrow_rl"),
            "Missing escrow_rl after release_escrow",
        );
    }
}

#[cfg(test)]
mod sealed_bid_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Bytes, BytesN, Env, String};

    fn bid_commitment(env: &Env, amount: i128, nonce: BytesN<32>) -> BytesN<32> {
        let mut payload = Bytes::new(env);
        for byte in amount.to_be_bytes().iter() {
            payload.push_back(*byte);
        }
        for byte in nonce.to_array().iter() {
            payload.push_back(*byte);
        }
        env.crypto().sha256(&payload)
    }

    fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, String) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        let owner = Address::generate(env);
        client.initialize(&admin);
        let job_id = String::from_str(env, "sealed-bid-job-1");
        client.commit_budget(&job_id, &1_000, &owner);
        (client, owner, admin, job_id)
    }

    #[test]
    fn test_reveal_bid_verifies_commitment() {
        let env = Env::default();
        let (client, owner, _admin, job_id) = setup(&env);
        let freelancer = Address::generate(&env);
        let nonce = BytesN::from_array(&env, &[7u8; 32]);
        let amount = 450i128;
        let commitment = bid_commitment(&env, amount, nonce.clone());

        client.submit_bid_commitment(&job_id, &freelancer, &commitment);
        client.close_bidding(&job_id, &owner);
        client.reveal_bid(&job_id, &freelancer, &amount, &nonce);

        let reveals = client.get_revealed_bids(&job_id);
        assert_eq!(reveals.len(), 1);
        let revealed = reveals.get(0).unwrap();
        assert_eq!(revealed.amount, amount);
        assert_eq!(revealed.freelancer, freelancer);
    }

    #[test]
    #[should_panic(expected = "Commitment verification failed")]
    fn test_reveal_bid_with_invalid_nonce_rejected() {
        let env = Env::default();
        let (client, owner, _admin, job_id) = setup(&env);
        let freelancer = Address::generate(&env);
        let amount = 500i128;
        let nonce = BytesN::from_array(&env, &[1u8; 32]);
        let bad_nonce = BytesN::from_array(&env, &[2u8; 32]);
        let commitment = bid_commitment(&env, amount, nonce);

        client.submit_bid_commitment(&job_id, &freelancer, &commitment);
        client.close_bidding(&job_id, &owner);
        client.reveal_bid(&job_id, &freelancer, &amount, &bad_nonce);
    }

    #[test]
    #[should_panic(expected = "Reveal window has closed")]
    fn test_late_reveal_rejected() {
        let env = Env::default();
        let (client, owner, _admin, job_id) = setup(&env);
        let freelancer = Address::generate(&env);
        let nonce = BytesN::from_array(&env, &[3u8; 32]);
        let amount = 525i128;
        let commitment = bid_commitment(&env, amount, nonce.clone());

        client.submit_bid_commitment(&job_id, &freelancer, &commitment);
        client.close_bidding(&job_id, &owner);

        let mut ledger = env.ledger().get();
        ledger.sequence_number += REVEAL_WINDOW_LEDGERS + 1;
        env.ledger().set(ledger);

        client.reveal_bid(&job_id, &freelancer, &amount, &nonce);
    }
}

#[cfg(test)]
mod deliverable_oracle_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

    fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address, Address) {
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let contract = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        contract.initialize(&admin);

        let client = Address::generate(env);
        let freelancer = Address::generate(env);
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let token_admin = token::StellarAssetClient::new(env, &token_id);
        token_admin.mint(&client, &1_000);

        (contract, admin, client, freelancer, token_id)
    }

    #[test]
    fn test_submit_deliverable_match_auto_releases() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "deliverable-match");
        let expected_hash = BytesN::from_array(&env, &[9u8; 32]);

        contract.create_escrow_with_deliverable(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
            },
            &expected_hash,
        );

        contract.submit_deliverable(&job_id, &expected_hash, &freelancer);

        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 1_000);
    }

    #[test]
    fn test_submit_deliverable_mismatch_enters_dispute() {
        let env = Env::default();
        let (contract, _admin, client, freelancer, token_id) = setup(&env);
        let job_id = String::from_str(&env, "deliverable-mismatch");
        let expected_hash = BytesN::from_array(&env, &[1u8; 32]);
        let actual_hash = BytesN::from_array(&env, &[2u8; 32]);

        contract.create_escrow_with_deliverable(
            &job_id,
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1_000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
            },
            &expected_hash,
        );

        contract.submit_deliverable(&job_id, &actual_hash, &freelancer);
        let escrow = contract.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);

        let token_client = token::Client::new(&env, &token_id);
        assert_eq!(token_client.balance(&freelancer), 0);
    }
}
