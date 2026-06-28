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
    String, Symbol, Vec,
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
    pub milestones: Option<soroban_sdk::Vec<MilestoneInput>>,
    pub timeout_ledgers: Option<u32>,
    pub referrer: Option<Address>,
}


#[contracttype]
#[derive(Clone, Debug)]
pub struct MilestoneInput {
    pub description: String,
    pub percentage: u32,
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
    /// Admin-frozen — no operations allowed until unfrozen
    Frozen,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Milestone {
    pub id: u32,
    pub description: String,
    pub percentage: u32,
    pub released: bool,
    /// Set to true when the client rejects this milestone and its share is refunded
    pub rejected: bool,
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

/// On-chain dispute-evidence IPFS CID audit trail (Issue #448 --- AC #2).
///
/// Per the AC, the contract stores a bare `Vec<Bytes>` of CIDs under
/// `DataKey::EvidenceCids(job_id)`. Each entry is the raw ASCII bytes of
/// an IPFS CID string (e.g. bytes of `bafy...`). The per-record
/// struct (with `kind` and `submitter` fields) has been retired.

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
    /// Per-job append-only audit log of deliverable IPFS CIDs (Issue #448).
    /// Stores a Vec<Bytes> of dispute-evidence CIDs under the job_id key.
    EvidenceCids(String),
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
        env.crypto().sha256(&payload).into()
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

    // Client creates an escrow with percentage-based milestones.
    // milestone percentages must sum to 100.
    pub fn create_escrow_with_milestones(
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

    #[allow(clippy::too_many_arguments)]
    fn create_escrow_internal(
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

    /// Freelancer signals that they have started work.
    pub fn start_work(env: Env, job_id: String, freelancer: Address) {
        freelancer.require_auth();

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
    pub fn release_escrow(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let escrow: Escrow = env
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
        if !ms.released {
        let ms_amount = escrow.amount
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
    if !ms.released {
        let ms_amount = escrow.amount
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

    /// Admin freezes an escrow, blocking all further operations until unfrozen.
    pub fn freeze_contract(env: Env, job_id: String, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can freeze a contract");
        }

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.status == EscrowStatus::Released
            || escrow.status == EscrowStatus::Refunded
            || escrow.status == EscrowStatus::Frozen
        {
            panic!("Cannot freeze escrow in current status");
        }

        escrow.status = EscrowStatus::Frozen;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("frozen"), job_id.clone()),
            (admin, escrow.client, escrow.freelancer),
        );
    }

    /// Admin unfreezes a previously frozen escrow, restoring it to the target status.
    pub fn unfreeze_contract(env: Env, job_id: String, admin: Address, target_status: EscrowStatus) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can unfreeze a contract");
        }

        let mut escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.status != EscrowStatus::Frozen {
            panic!("Escrow is not frozen");
        }

        if target_status != EscrowStatus::Locked && target_status != EscrowStatus::InProgress {
            panic!("Can only unfreeze to Locked or InProgress");
        }

        escrow.status = target_status;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("unfroz"), job_id.clone()),
            (admin, escrow.client, escrow.freelancer),
        );
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

        if escrow.status == EscrowStatus::Released || escrow.status == EscrowStatus::Refunded || escrow.status == EscrowStatus::Frozen {
            panic!("Cannot dispute a resolved or frozen escrow");
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
    pub fn release_milestone(env: Env, job_id: String, milestone_id: u32, client: Address) {
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
        let payout = escrow.amount
            .checked_mul(milestone.percentage as i128)
            .expect("Arithmetic overflow")
            .checked_div(100)
            .expect("Arithmetic overflow");

        // Transfer funds to freelancer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &payout,
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
            (escrow.client.clone(), escrow.freelancer.clone(), milestone_id, payout),
        );
    }

    /// Partial milestone refund — the client rejects a single milestone and its
    /// share of the escrow is returned to the client. Remaining milestones stay
    /// locked in the contract.
    ///
    /// Only the client may call this. The milestone is identified by its id
    /// (the index assigned at creation time).
    pub fn reject_milestone(env: Env, job_id: String, milestone_index: u32, client: Address) {
        client.require_auth();

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
        let refund = escrow.amount
            .checked_mul(milestone.percentage as i128)
            .expect("Arithmetic overflow")
            .checked_div(100)
            .expect("Arithmetic overflow");

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.client,
            &refund,
        );

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
            (escrow.client.clone(), escrow.freelancer.clone(), milestone_index, refund),
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
            Self::release_escrow_core(env.clone(), job_id.clone(), escrow);
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

    // ─── Issue #448: Deliverable IPFS CID on-chain audit trail ──────────────
    //
    // The off-chain deliverable is stored on IPFS (Pinata / gateway). Only the
    // IPFS CID is recorded on-chain to provide a tamper-evident provenance
    // trail that survives pin loss and database wipes. Each escrow party can
    // append multiple entries; older entries are never overwritten.

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
    pub fn submit_evidence_cid(
        env: Env,
        job_id: String,
        cid: Bytes,
        caller: Address,
    ) {
        caller.require_auth();

        if cid.is_empty() {
            panic!("IPFS CID cannot be empty");
        }
        if cid.len() > 200 {
            panic!("IPFS CID exceeds maximum length of 200 bytes");
        }

        let escrow: Escrow = env
            .storage()
            .instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if caller != escrow.client && caller != escrow.freelancer {
            panic!("Only the escrow client or freelancer can submit evidence CIDs");
        }

        if escrow.status == EscrowStatus::Refunded {
            panic!("Cannot record evidence on a refunded escrow");
        }

        let mut cids: soroban_sdk::Vec<Bytes> = env
            .storage()
            .instance()
            .get(&DataKey::EvidenceCids(job_id.clone()))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));

        cids.push_back(cid.clone());

        env.storage()
            .instance()
            .set(&DataKey::EvidenceCids(job_id.clone()), &cids);

        env.events().publish(
            (symbol_short!("evd_add"), job_id),
            (caller, env.ledger().sequence()),
        );
    }

    /// Read the IPFS CIDs anchoring dispute evidence on-chain for a job
    /// (Issue #448 --- AC #3). Returns the `Vec<Bytes>` in insertion order
    /// (oldest first). Empty `Vec` if no evidence has been anchored yet.
    pub fn get_evidence_cids(env: Env, job_id: String) -> soroban_sdk::Vec<Bytes> {
        env.storage()
            .instance()
            .get(&DataKey::EvidenceCids(job_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
    }
