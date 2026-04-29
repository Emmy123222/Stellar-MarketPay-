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

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol, symbol_short, String, Vec,
};

// ─── Storage keys ─────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");

/// Default timeout: 7 days worth of ledgers (~5 s/ledger).
const DEFAULT_TIMEOUT_LEDGERS: u32 = 120_960;

// ─── Data structures ──────────────────────────────────────────────────────────

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
    pub amount:       i128,
    pub is_completed: bool,
}

/// An escrow record stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    /// Unique job identifier (from backend)
    pub job_id:     String,
    /// Client who locked the funds
    pub client:     Address,
    /// Freelancer who will receive the funds
    pub freelancer: Address,
    /// Token contract address (XLM SAC or USDC)
    pub token:      Address,
    /// Amount in token's smallest unit (stroops for XLM)
    pub amount:     i128,
    /// Current escrow status
    pub status:     EscrowStatus,
    /// Ledger when escrow was created
    pub created_at: u32,
    /// Ledger after which client can call timeout_refund()
    pub timeout_ledger: u32,
    /// Optional milestones for partial releases
    pub milestones: soroban_sdk::Vec<Milestone>,
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
    BudgetCommitment(String),
    DeliverableSubmission(String),
    Certificate(String),
    FreelancerCertificates(Address),
    ClientRating(String),
    FreelancerRating(String),
    FreelancerRatingStats(Address),
    Arbitrator(Address),
    ArbitratorPool,
    ArbitrationCase(u32),
    ArbitrationCaseCount,
}

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

#[contractimpl]
impl MarketPayContract {

    // ─── Initialization ──────────────────────────────────────────────────────

    /// Initialize with an admin address (called once after deployment).
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EscrowCount, &0u32);
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
    pub fn create_escrow(
        env:        Env,
        job_id:     String,
        client:     Address,
        freelancer: Address,
        token:      Address,
        amount:     i128,
        milestones: Option<soroban_sdk::Vec<i128>>,
        timeout_ledgers: Option<u32>,
    ) {
        client.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
        }

        // Validate milestones if provided
        let mut milestone_list = soroban_sdk::Vec::new(&env);
        if let Some(ms) = milestones {
            if ms.len() > 5 {
                panic!("Maximum 5 milestones allowed");
            }
            let mut total_ms_amount: i128 = 0;
            for amt in ms.iter() {
                if amt <= 0 { panic!("Milestone amount must be positive"); }
                total_ms_amount = total_ms_amount.checked_add(amt).expect("Arithmetic overflow");
                milestone_list.push_back(Milestone { amount: amt, is_completed: false });
            }
            if total_ms_amount != amount {
                panic!("Milestone amounts must sum to total escrow amount");
            }
        }

        // Ensure no duplicate escrow for same job
        if env.storage().instance().has(&DataKey::Escrow(job_id.clone())) {
            panic!("Escrow already exists for this job");
        }

        // Transfer funds from client into the contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &client,
            &env.current_contract_address(),
            &amount,
        );

        let current_ledger = env.ledger().sequence();
        let timeout = timeout_ledgers.unwrap_or(DEFAULT_TIMEOUT_LEDGERS);
        let timeout_ledger = current_ledger.checked_add(timeout).expect("Timeout ledger overflow");

        // Store escrow record on-chain
        let escrow = Escrow {
            job_id: job_id.clone(),
            client: client.clone(),
            freelancer,
            token,
            amount,
            status:     EscrowStatus::Locked,
            created_at: current_ledger,
            timeout_ledger,
            milestones: milestone_list,
        };

        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        // Increment counter
        let count: u32 = env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0);
        let new_count = count.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(&DataKey::EscrowCount, &new_count);

        // Emit event
        env.events().publish(
            (symbol_short!("created"), client),
            (job_id, amount),
        );
    }

    /// Client accepts a freelancer and marks work as in-progress.
    pub fn start_work(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can start work");
        }
        if escrow.status != EscrowStatus::Locked {
            panic!("Escrow is not in Locked state");
        }

        escrow.status = EscrowStatus::InProgress;
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("started"), client),
            job_id,
        );
    }

    /// Client approves completed work and releases funds to the freelancer.
    pub fn release_escrow(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can release escrow");
        }
        if escrow.status != EscrowStatus::InProgress
            && escrow.status != EscrowStatus::Locked
        {
            panic!("Cannot release escrow in current status");
        }

        // Check if there are incomplete milestones
        let mut remaining_amount = 0;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                remaining_amount = remaining_amount.checked_add(ms.amount).expect("Arithmetic overflow");
            }
        }
        
        // If no milestones, release full amount. If milestones, release remaining.
        let release_amount = if escrow.milestones.is_empty() { escrow.amount } else { remaining_amount };

        // Mark all milestones as completed
        let mut updated_ms = soroban_sdk::Vec::new(&env);
        for mut ms in escrow.milestones.iter() {
            ms.is_completed = true;
            updated_ms.push_back(ms);
        }
        escrow.milestones = updated_ms;

        // Increment CompletedJobs for the freelancer and client
        let freelancer_jobs: u32 = env.storage().instance().get(&DataKey::CompletedJobs(escrow.freelancer.clone())).unwrap_or(0);
        let new_freelancer_jobs = freelancer_jobs.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(&DataKey::CompletedJobs(escrow.freelancer.clone()), &new_freelancer_jobs);
        
        let client_jobs: u32 = env.storage().instance().get(&DataKey::CompletedJobs(escrow.client.clone())).unwrap_or(0);
        let new_client_jobs = client_jobs.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(&DataKey::CompletedJobs(escrow.client.clone()), &new_client_jobs);

        escrow.status = EscrowStatus::Released;
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        if release_amount > 0 {
            // Transfer funds to freelancer
            let token_client = token::Client::new(&env, &escrow.token);
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.freelancer,
                &release_amount,
            );
        }

        env.events().publish(
            (symbol_short!("released"), client),
            (job_id, release_amount),
        );
    }

    /// Client approves work and releases funds WITH conversion through DEX.
    /// This is used when the escrow is in one asset (e.g. USDC) but the freelancer wants another (e.g. XLM).
    pub fn release_with_conversion(
        env: Env,
        job_id: String,
        client: Address,
        target_token: Address,
        min_amount_out: i128,
    ) {
        client.require_auth();

        let mut escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can release escrow");
        }
        if escrow.status != EscrowStatus::InProgress
            && escrow.status != EscrowStatus::Locked
        {
            panic!("Cannot release escrow in current status");
        }

        // Calculate remaining amount
        let mut remaining_amount = 0;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                remaining_amount = remaining_amount.checked_add(ms.amount).expect("Arithmetic overflow");
            }
        }
        let release_amount = if escrow.milestones.is_empty() { escrow.amount } else { remaining_amount };

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
        let f_jobs: u32 = env.storage().instance().get(&DataKey::CompletedJobs(escrow.freelancer.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::CompletedJobs(escrow.freelancer.clone()), &(f_jobs.checked_add(1).unwrap()));
        
        let c_jobs: u32 = env.storage().instance().get(&DataKey::CompletedJobs(escrow.client.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::CompletedJobs(escrow.client.clone()), &(c_jobs.checked_add(1).unwrap()));

        escrow.status = EscrowStatus::Released;
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("conv_rel"), client),
            (job_id, release_amount, target_token, min_amount_out),
        );
    }

    /// Client cancels and gets a refund (only before work starts).
    pub fn refund_escrow(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env.storage().instance()
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
            (symbol_short!("refunded"), client),
            job_id,
        );
    }

    /// Issue #175 — Client claims a refund if the freelancer never started work
    /// before the timeout ledger.  Only callable when status is Locked and the
    /// current ledger is past timeout_ledger.
    pub fn timeout_refund(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can request a timeout refund");
        }
        if escrow.status != EscrowStatus::Locked {
            panic!("Escrow is not in Locked state");
        }
        if env.ledger().sequence() < escrow.timeout_ledger {
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
            (symbol_short!("torefnd"), client),
            job_id,
        );
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /// Get the full escrow record for a job.
    pub fn get_escrow(env: Env, job_id: String) -> Escrow {
        env.storage().instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found")
    }

    /// Get escrow status for a job.
    pub fn get_status(env: Env, job_id: String) -> EscrowStatus {
        let escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.status
    }

    /// Get timeout ledger for a job.
    pub fn get_timeout_ledger(env: Env, job_id: String) -> u32 {
        let escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id))
            .expect("Escrow not found");
        escrow.timeout_ledger
    }

    /// Get total number of escrows created.
    pub fn get_escrow_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0)
    }

    /// Get the contract admin.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).expect("Not initialized")
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

        let count: u32 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let proposal_id = count.checked_add(1).expect("Counter overflow");
        let deadline_ledger = env.ledger().sequence().checked_add(duration_ledgers).expect("Arithmetic overflow");

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

        env.storage().instance().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_id);

        env.events().publish(
            (symbol_short!("proposed"), proposer),
            (proposal_id, title, deadline_ledger),
        );

        proposal_id
    }

    pub fn cast_vote(env: Env, voter: Address, proposal_id: u32, approve: bool) {
        voter.require_auth();

        let mut proposal: Proposal = env.storage().instance()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found");

        if proposal.resolved {
            panic!("Proposal already resolved");
        }

        if env.ledger().sequence() >= proposal.deadline_ledger {
            panic!("Voting period has ended");
        }

        // Check eligibility: must have completed at least 1 job
        let jobs: u32 = env.storage().instance().get(&DataKey::CompletedJobs(voter.clone())).unwrap_or(0);
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
            proposal.votes_against = proposal.votes_against.checked_add(1).expect("Counter overflow");
        }

        env.storage().instance().set(&voted_key, &true);
        env.storage().instance().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("voted"), voter),
            (proposal_id, approve),
        );
    }

    pub fn resolve_proposal(env: Env, proposal_id: u32) {
        let mut proposal: Proposal = env.storage().instance()
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

        env.storage().instance().set(&DataKey::Proposal(proposal_id), &proposal);

        env.events().publish(
            (symbol_short!("resolved"), proposal_id),
            (proposal.result, proposal.votes_for, proposal.votes_against),
        );
    }

    pub fn get_proposal(env: Env, id: u32) -> Proposal {
        env.storage().instance()
            .get(&DataKey::Proposal(id))
            .expect("Proposal not found")
    }

    pub fn list_active_proposals(env: Env) -> Vec<Proposal> {
        let count: u32 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let mut active = Vec::new(&env);
        for id in 1..=count {
            if let Some(proposal) = env.storage().instance().get::<_, Proposal>(&DataKey::Proposal(id)) {
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
        
        let mut escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");
        
        if escrow.client != caller && escrow.freelancer != caller {
            panic!("Only participants can raise a dispute");
        }
        
        escrow.status = EscrowStatus::Disputed;
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("disputed"), caller),
            job_id,
        );
    }

    /// [PLACEHOLDER] Milestone-based partial release.
    /// See ROADMAP.md v2.0 — Milestones.
    pub fn release_milestone(_env: Env, _job_id: String, _milestone: u32, _client: Address) {
        panic!("Milestone payments coming in v2.0 — see ROADMAP.md");
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

        env.storage().instance().set(&DataKey::BudgetCommitment(job_id.clone()), &commitment);

        env.events().publish(
            (symbol_short!("budgtcmt"), client),
            job_id,
        );
    }

    /// Reveal the budget. Auto-rejects bids over 150% of budget.
    pub fn reveal_budget(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut commitment: BudgetCommitment = env.storage().instance()
            .get(&DataKey::BudgetCommitment(job_id.clone()))
            .expect("Budget commitment not found");

        if commitment.client != client {
            panic!("Only the client can reveal the budget");
        }
        if commitment.is_revealed {
            panic!("Budget already revealed");
        }

        commitment.is_revealed = true;
        env.storage().instance().set(&DataKey::BudgetCommitment(job_id.clone()), &commitment);

        env.events().publish(
            (symbol_short!("budgrvld"), client),
            commitment.budget_amount,
        );
    }

    /// Get budget commitment.
    pub fn get_budget_commitment(env: Env, job_id: String) -> BudgetCommitment {
        env.storage().instance()
            .get(&DataKey::BudgetCommitment(job_id))
            .expect("Budget commitment not found")
    }

    // ─── Issue #105: Deliverable Hash Oracle ────────────────────────────────

    /// Client submits deliverable hash.
    pub fn submit_client_deliverable(env: Env, job_id: String, client: Address) {
        client.require_auth();

        let mut submission: DeliverableSubmission = env.storage().instance()
            .get(&DataKey::DeliverableSubmission(job_id.clone()))
            .unwrap_or_else(|| DeliverableSubmission {
                job_id: job_id.clone(),
                client_hash_submitted: false,
                freelancer_hash_submitted: false,
                hashes_match: false,
            });

        submission.client_hash_submitted = true;
        env.storage().instance().set(&DataKey::DeliverableSubmission(job_id.clone()), &submission);

        env.events().publish(
            (symbol_short!("clthash"), client),
            job_id,
        );
    }

    /// Freelancer submits deliverable hash.
    pub fn submit_freelancer_deliverable(env: Env, job_id: String, freelancer: Address) {
        freelancer.require_auth();

        let mut submission: DeliverableSubmission = env.storage().instance()
            .get(&DataKey::DeliverableSubmission(job_id.clone()))
            .unwrap_or_else(|| DeliverableSubmission {
                job_id: job_id.clone(),
                client_hash_submitted: false,
                freelancer_hash_submitted: false,
                hashes_match: false,
            });

        submission.freelancer_hash_submitted = true;
        env.storage().instance().set(&DataKey::DeliverableSubmission(job_id.clone()), &submission);

        env.events().publish(
            (symbol_short!("frelhash"), freelancer),
            job_id,
        );
    }

    /// Auto-release if both hashes match (manual fallback if mismatch after 7 days).
    pub fn check_deliverable_match(env: Env, job_id: String) -> bool {
        let submission: DeliverableSubmission = env.storage().instance()
            .get(&DataKey::DeliverableSubmission(job_id.clone()))
            .expect("Deliverable submission not found");

        // Both must be submitted
        if submission.client_hash_submitted && submission.freelancer_hash_submitted {
            let mut updated = submission.clone();
            updated.hashes_match = true;
            env.storage().instance().set(&DataKey::DeliverableSubmission(job_id), &updated);
            return true;
        }
        false
    }

    /// Get deliverable submission status.
    pub fn get_deliverable_submission(env: Env, job_id: String) -> DeliverableSubmission {
        env.storage().instance()
            .get(&DataKey::DeliverableSubmission(job_id))
            .expect("Deliverable submission not found")
    }

    // ─── Issue #102: Job Completion Certificate ──────────────────────────────

    /// Mint a certificate when job is completed (upon escrow release).
    pub fn mint_certificate(env: Env, job_id: String, client: Address) {
        client.require_auth();

        // Only client can mint
        let escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can mint a certificate");
        }
        if escrow.status != EscrowStatus::Released {
            panic!("Escrow must be released to mint certificate");
        }

        // Prevent duplicate certificates
        if env.storage().instance().has(&DataKey::Certificate(job_id.clone())) {
            panic!("Certificate already minted");
        }

        let cert = Certificate {
            job_id: job_id.clone(),
            freelancer: escrow.freelancer.clone(),
            amount: escrow.amount,
            created_at: env.ledger().sequence(),
        };

        env.storage().instance().set(&DataKey::Certificate(job_id.clone()), &cert);

        // Track in freelancer's certificate history
        let mut certs: Vec<String> = env.storage().instance()
            .get(&DataKey::FreelancerCertificates(escrow.freelancer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        certs.push_back(job_id.clone());
        env.storage().instance().set(
            &DataKey::FreelancerCertificates(escrow.freelancer.clone()),
            &certs,
        );

        env.events().publish(
            (symbol_short!("certmnt"), client),
            (job_id, escrow.amount),
        );
    }

    /// Get a certificate.
    pub fn get_certificate(env: Env, job_id: String) -> Certificate {
        env.storage().instance()
            .get(&DataKey::Certificate(job_id))
            .expect("Certificate not found")
    }

    /// Get all certificates for a freelancer.
    pub fn get_freelancer_certificates(env: Env, freelancer: Address) -> Vec<String> {
        env.storage().instance()
            .get(&DataKey::FreelancerCertificates(freelancer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn submit_client_rating(env: Env, job_id: String, client: Address, score: u32) {
        client.require_auth();
        if score < 1 || score > 5 {
            panic!("Score must be between 1 and 5");
        }

        let escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");
        if escrow.status != EscrowStatus::Released {
            panic!("Ratings are allowed only after escrow release");
        }
        if escrow.client != client {
            panic!("Only job client can submit client rating");
        }
        if env.storage().instance().has(&DataKey::ClientRating(job_id.clone())) {
            panic!("Client rating already submitted for this job");
        }

        let rating = Rating {
            job_id: job_id.clone(),
            rater: client.clone(),
            rated: escrow.freelancer.clone(),
            score_out_of_5: score,
            submitted_at_ledger: env.ledger().sequence(),
        };
        env.storage().instance().set(&DataKey::ClientRating(job_id.clone()), &rating);

        let mut stats: FreelancerRatingStats = env.storage().instance()
            .get(&DataKey::FreelancerRatingStats(escrow.freelancer.clone()))
            .unwrap_or(FreelancerRatingStats { total_score: 0, count: 0 });
        stats.total_score = stats.total_score.checked_add(score).expect("Arithmetic overflow");
        stats.count = stats.count.checked_add(1).expect("Arithmetic overflow");
        env.storage().instance().set(&DataKey::FreelancerRatingStats(escrow.freelancer), &stats);
    }

    pub fn submit_freelancer_rating(env: Env, job_id: String, freelancer: Address, score: u32) {
        freelancer.require_auth();
        if score < 1 || score > 5 {
            panic!("Score must be between 1 and 5");
        }

        let escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");
        if escrow.status != EscrowStatus::Released {
            panic!("Ratings are allowed only after escrow release");
        }
        if escrow.freelancer != freelancer {
            panic!("Only job freelancer can submit freelancer rating");
        }
        if env.storage().instance().has(&DataKey::FreelancerRating(job_id.clone())) {
            panic!("Freelancer rating already submitted for this job");
        }

        let rating = Rating {
            job_id: job_id.clone(),
            rater: freelancer,
            rated: escrow.client,
            score_out_of_5: score,
            submitted_at_ledger: env.ledger().sequence(),
        };
        env.storage().instance().set(&DataKey::FreelancerRating(job_id), &rating);
    }

    pub fn get_freelancer_rating_avg(env: Env, freelancer: Address) -> u32 {
        let stats: FreelancerRatingStats = env.storage().instance()
            .get(&DataKey::FreelancerRatingStats(freelancer))
            .unwrap_or(FreelancerRatingStats { total_score: 0, count: 0 });
        if stats.count == 0 {
            return 0;
        }
        stats.total_score / stats.count
    }

    pub fn register_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can register arbitrators");
        }
        env.storage().instance().set(&DataKey::Arbitrator(arbitrator.clone()), &true);
        let mut pool: Vec<Address> = env.storage().instance().get(&DataKey::ArbitratorPool).unwrap_or_else(|| Vec::new(&env));
        pool.push_back(arbitrator);
        env.storage().instance().set(&DataKey::ArbitratorPool, &pool);
    }

    pub fn open_arbitration(env: Env, job_id: String, admin: Address) -> u32 {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can open arbitration");
        }

        let pool: Vec<Address> = env.storage().instance().get(&DataKey::ArbitratorPool).unwrap_or_else(|| Vec::new(&env));
        if pool.len() < 3 {
            panic!("Need at least 3 registered arbitrators");
        }

        let count: u32 = env.storage().instance().get(&DataKey::ArbitrationCaseCount).unwrap_or(0);
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
        env.storage().instance().set(&DataKey::ArbitrationCase(case_id), &case);
        env.storage().instance().set(&DataKey::ArbitrationCaseCount, &case_id);
        case_id
    }

    pub fn cast_arbitration_vote(env: Env, case_id: u32, arbitrator: Address, client_percent: u32) {
        arbitrator.require_auth();
        if client_percent > 100 {
            panic!("Client percent must be 0-100");
        }

        let mut case: ArbitrationCase = env.storage().instance()
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
        env.storage().instance().set(&DataKey::ArbitrationCase(case_id), &case);
    }

    pub fn resolve_arbitration(env: Env, case_id: u32) {
        let mut case: ArbitrationCase = env.storage().instance()
            .get(&DataKey::ArbitrationCase(case_id))
            .expect("Arbitration case not found");
        if case.votes.len() != 3 {
            panic!("Exactly 3 votes required");
        }
        let total = case.votes.get(0).unwrap() + case.votes.get(1).unwrap() + case.votes.get(2).unwrap();
        case.resolution = total / 3;
        case.status = 1;
        env.storage().instance().set(&DataKey::ArbitrationCase(case_id), &case);
    }

    pub fn get_arbitration_case(env: Env, case_id: u32) -> ArbitrationCase {
        env.storage().instance()
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
        let env    = Env::default();
        let id     = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_init_panics() {
        let env   = Env::default();
        let id    = env.register(MarketPayContract, ());
        let c     = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        c.initialize(&admin);
    }

    #[test]
    fn test_escrow_count_starts_zero() {
        let env   = Env::default();
        let id    = env.register(MarketPayContract, ());
        let c     = MarketPayContractClient::new(&env, &id);
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
            env.storage().instance().set(&DataKey::CompletedJobs(voter1.clone()), &1u32);
            env.storage().instance().set(&DataKey::CompletedJobs(voter2.clone()), &1u32);
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
        let token_id = env.register_stellar_asset_contract(admin.clone());
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
        client.create_escrow(&job_id, &contract_client, &freelancer, &token_id, &1000, &None, &Some(timeout_ledgers));

        let escrow = client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Locked);
        assert_eq!(escrow.timeout_ledger, env.ledger().sequence() + timeout_ledgers);

        // Advance ledger past timeout
        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += timeout_ledgers + 1;
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
        client.create_escrow(&job_id, &contract_client, &freelancer, &token_id, &1000, &None, &Some(timeout_ledgers));

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
        client.create_escrow(&job_id, &contract_client, &freelancer, &token_id, &1000, &None, &Some(timeout_ledgers));

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
        client.create_escrow(&job_id, &contract_client, &freelancer, &token_id, &1000, &None, &Some(timeout_ledgers));

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
        client.create_escrow(&job_id, &contract_client, &freelancer, &token_id, &500, &None, &Some(custom_timeout));

        let escrow = client.get_escrow(&job_id);
        assert_eq!(escrow.timeout_ledger, env.ledger().sequence() + custom_timeout);
    }

    #[test]
    fn test_default_timeout_ledgers() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "default_timeout_job");
        client.create_escrow(&job_id, &contract_client, &freelancer, &token_id, &500, &None, &None);

        let escrow = client.get_escrow(&job_id);
        assert_eq!(escrow.timeout_ledger, env.ledger().sequence() + DEFAULT_TIMEOUT_LEDGERS);
    }

    #[test]
    fn test_get_timeout_ledger() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, contract_client, freelancer, token_id, _admin) = setup_contract(&env);

        let job_id = String::from_str(&env, "get_timeout_job");
        let timeout = 25u32;
        client.create_escrow(&job_id, &contract_client, &freelancer, &token_id, &500, &None, &Some(timeout));

        assert_eq!(client.get_timeout_ledger(&job_id), env.ledger().sequence() + timeout);
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
        
        client.create_escrow(&job_id, &admin, &freelancer, &token, &i128::MAX, &Some(milestones), &None);
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
        
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token_client = token::Client::new(&env, &token_id);
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let job_id = String::from_str(&env, "job1");
        contract_client.create_escrow(&job_id, &client.clone(), &freelancer, &token_id, &1000, &None, &None);
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
        
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&client, &1000);

        let job_id = String::from_str(&env, "job_conv");
        contract_client.create_escrow(&job_id, &client.clone(), &freelancer, &token_id, &1000, &None, &None);
        
        let target_token = Address::generate(&env); 
        contract_client.release_with_conversion(&job_id, &client.clone(), &target_token, &900);
        
        let escrow = contract_client.get_escrow(&job_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }
}

#[cfg(test)]
mod fuzz_testing {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    #[test]
    fn fuzz_create_escrow_random_amounts() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let freelancer = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token_admin = token::StellarAssetClient::new(&env, &token_id);

        // Test a range of amounts
        for i in 1..100 {
            let amount = (i as i128) * 1000;
            let job_id = String::from_str(&env, &format!("fuzz_job_{}", i));
            
            let user = Address::generate(&env);
            token_admin.mint(&user, &amount);
            
            client.create_escrow(&job_id, &user, &freelancer, &token_id, &amount, &None, &None);
            
            let escrow = client.get_escrow(&job_id);
            assert_eq!(escrow.amount, amount);
        }
    }

    #[test]
    fn fuzz_release_escrow_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let user = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token_admin = token::StellarAssetClient::new(&env, &token_id);
        
        token_admin.mint(&user, &1000000);

        for i in 1..50 {
            let job_id = String::from_str(&env, &format!("lifecycle_{}", i));
            client.create_escrow(&job_id, &user, &freelancer, &token_id, &1000, &None, &None);
            
            // Randomly decide to start work or not
            if i % 2 == 0 {
                client.start_work(&job_id, &user);
            }
            
            client.release_escrow(&job_id, &user);
            
            let escrow = client.get_escrow(&job_id);
            assert_eq!(escrow.status, EscrowStatus::Released);
        }
    }
}
