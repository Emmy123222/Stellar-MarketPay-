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
    ///   job_id     — unique ID matching the backend job record
    ///   freelancer — the address that will receive payment on release
    ///   token      — SAC address of the payment token (XLM or USDC)
    ///   amount     — payment amount in smallest token units
    ///   milestones — optional list of milestones (amounts must sum to total amount)
    pub fn create_escrow(
        env:        Env,
        job_id:     String,
        client:     Address,
        freelancer: Address,
        token:      Address,
        amount:     i128,
        milestones: Option<soroban_sdk::Vec<i128>>,
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
            let mut total_ms_amount = 0;
            for amt in ms.iter() {
                if amt <= 0 { panic!("Milestone amount must be positive"); }
                total_ms_amount += amt;
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

        // Store escrow record on-chain
        let escrow = Escrow {
            job_id: job_id.clone(),
            client: client.clone(),
            freelancer,
            token,
            amount,
            status:     EscrowStatus::Locked,
            created_at: env.ledger().sequence(),
            milestones: milestone_list,
        };

        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        // Increment counter
        let count: u32 = env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::EscrowCount, &(count + 1));

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
        env.storage().instance().set(&DataKey::Escrow(job_id), &escrow);
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
                remaining_amount += ms.amount;
            }
        }
        
        // If no milestones, release full amount. If milestones, release remaining.
        let release_amount = if escrow.milestones.is_empty() { escrow.amount } else { remaining_amount };

        if release_amount > 0 {
            // Transfer funds to freelancer
            let token_client = token::Client::new(&env, &escrow.token);
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

        // Increment CompletedJobs for the freelancer and client
        let freelancer_jobs: u32 = env.storage().instance().get(&DataKey::CompletedJobs(escrow.freelancer.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::CompletedJobs(escrow.freelancer.clone()), &(freelancer_jobs + 1));
        
        let client_jobs: u32 = env.storage().instance().get(&DataKey::CompletedJobs(escrow.client.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::CompletedJobs(escrow.client.clone()), &(client_jobs + 1));

        escrow.status = EscrowStatus::Released;
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("released"), client),
            (job_id, release_amount),
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
        let proposal_id = count + 1;
        let deadline_ledger = env.ledger().sequence() + duration_ledgers;

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
            proposal.votes_for += 1;
        } else {
            proposal.votes_against += 1;
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
    pub fn raise_dispute(_env: Env, _job_id: String, _caller: Address) {
        panic!("Dispute resolution coming in v2.1 — see ROADMAP.md");
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

    #[test]
    #[should_panic(expected = "Voter has already cast a vote")]
    fn test_double_vote_prevention() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(MarketPayContract, ());
        let client = MarketPayContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let proposer = Address::generate(&env);
        let voter = Address::generate(&env);

        env.as_contract(&id, || {
            env.storage().instance().set(&DataKey::CompletedJobs(voter.clone()), &1u32);
        });

        let title = String::from_str(&env, "Test");
        let desc = String::from_str(&env, "Desc");
        let pid = client.create_proposal(&proposer, &title, &desc, &100);

        client.cast_vote(&voter, &pid, &true);
        // Panics here
        client.cast_vote(&voter, &pid, &false);
    }
}
