#![no_std]

//! contracts/marketpay-contract/src/lib.rs
//!
//! Stellar MarketPay — Soroban Escrow Contract
//!
//! This contract manages trustless escrow between a client and freelancer:
//!
//!   1. Client calls create_escrow() — locks XLM in the contract
//!   2. Freelancer does the work
//!   3. Client calls release_escrow() — funds sent to freelancer
//!      OR client calls refund_escrow() before work starts — funds returned
//!
//! Build:
//!   cargo build --target wasm32-unknown-unknown --release
//!
//! Deploy:
//!   stellar contract deploy \
//!     --wasm target/wasm32-unknown-unknown/release/marketpay_contract.wasm \
//!     --source alice --network testnet

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, vec, Address, Env, Symbol, Vec, symbol_short, String,
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


/// A single milestone within an escrow.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Milestone {
    /// Unique milestone index within the job (0-based)
    pub id:          u32,
    /// Human-readable description stored on-chain
    pub description: String,
    /// Percentage of total escrow amount unlocked by this milestone (1–100)
    pub percentage:  u32,
    /// Whether this milestone's funds have already been released
    pub released:    bool,
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

    pub milestones: Vec<Milestone>,
}

/// Storage key per job
#[contracttype]
pub enum DataKey {
    Admin,
    Escrow(String),
    EscrowCount,
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
    pub fn create_escrow(
        env:        Env,
        job_id:     String,
        client:     Address,
        freelancer: Address,
        token:      Address,
        amount:     i128,
    ) {
        client.require_auth();

        if amount <= 0 {
            panic!("Amount must be positive");
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
            milestones: vec![&env], 
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

     // ─── Milestone escrow ─────────────────────────────────────────────────────
 
    /// Client creates a milestone-based escrow.
    ///
    /// Rules:
    ///   • 1–5 milestones allowed
    ///   • All `percentage` values must be ≥ 1
    ///   • Percentages must sum to exactly 100
    ///   • Funds are locked in full up-front; released incrementally
    pub fn create_escrow_with_milestones(
         env:        Env,
        job_id:     String,
        client:     Address,
        freelancer: Address,
        token:      Address,
        amount:     i128,
        milestones: Vec<Milestone>,
    ) {
        client.require_auth();
 
        if amount <= 0 {
            panic!("Amount must be positive");
        }
 
        if env.storage().instance().has(&DataKey::Escrow(job_id.clone())) {
            panic!("Escrow already exists for this job");
        }
         // ── Milestone validation ──────────────────────────────────────────────
 
        let n = milestones.len();
        if n == 0 || n > 5 {
            panic!("Must provide 1 to 5 milestones");
        }
 
        let mut pct_sum: u32 = 0;
        for i in 0..n {
            let m = milestones.get(i).unwrap();
            if m.percentage == 0 {
                panic!("Each milestone percentage must be at least 1");
            }
            if m.released {
                panic!("Milestones must start unreleased");
            }
            pct_sum += m.percentage;
        }
 
        if pct_sum != 100 {
            panic!("Milestone percentages must sum to exactly 100");
        }
 
        // ── Fund the contract ─────────────────────────────────────────────────
 
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(
            &client,
            &env.current_contract_address(),
            &amount,
        );
 
        // ── Persist ───────────────────────────────────────────────────────────
 
        let escrow = Escrow {
            job_id:     job_id.clone(),
            client:     client.clone(),
            freelancer,
            token,
            amount,
            status:     EscrowStatus::Locked,
            created_at: env.ledger().sequence(),
            milestones,
        };
 
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);
 
        let count: u32 = env.storage().instance()
            .get(&DataKey::EscrowCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::EscrowCount, &(count + 1));
 
        env.events().publish(
            (symbol_short!("created"), client),
            (job_id, amount),
        );
    }
 
    /// Client approves a specific milestone and releases its share of funds
    /// to the freelancer.
    ///
    /// - Calculates `amount * percentage / 100` (integer division, rounded down).
    /// - Marks that milestone as `released = true`.
    /// - If all milestones are now released, sets escrow status to `Released`.
    /// - Emits a `ms_rel` (milestone_released) event.
    pub fn release_milestone(
        env:          Env,
        job_id:       String,
        milestone_id: u32,
        client:       Address,
    ) {
        client.require_auth();
 
        let mut escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");
 
        if escrow.client != client {
            panic!("Only the client can release milestones");
        }
 
        if escrow.milestones.len() == 0 {
            panic!("This escrow has no milestones — use release_escrow instead");
        }
 
        if escrow.status == EscrowStatus::Released
            || escrow.status == EscrowStatus::Refunded
        {
            panic!("Escrow is already closed");
        }
 
        // ── find the target milestone ─────────────────────────────────────────
 
        let n = escrow.milestones.len();
        let mut milestone_index: Option<u32> = None;
 
        for i in 0..n {
            let m = escrow.milestones.get(i).unwrap();
            if m.id == milestone_id {
                milestone_index = Some(i);
                break;
            }
        }
 
        let idx = milestone_index.expect("Milestone not found");
        let mut milestone = escrow.milestones.get(idx).unwrap();
 
        if milestone.released {
            panic!("Milestone already released");
        }
 
        // ── Calculate payout ──────────────────────────────────────────────────

        let payout: i128 = (escrow.amount * milestone.percentage as i128) / 100;
 
        if payout <= 0 {
            panic!("Milestone payout rounds to zero — amount too small");
        }
 
        // ── Transfer to freelancer ────────────────────────────────────────────
 
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &payout,
        );
 
        // ── Update milestone state ────────────────────────────────────────────
 
        milestone.released = true;
        let mut updated_milestones: Vec<Milestone> = Vec::new(&env);
        for i in 0..n {
            if i == idx {
                updated_milestones.push_back(milestone.clone());
            } else {
                updated_milestones.push_back(escrow.milestones.get(i).unwrap());
            }
        }
        escrow.milestones = updated_milestones;
 
        //  Checking  if all milestones are released
 
        let all_released = (0..escrow.milestones.len())
            .all(|i| escrow.milestones.get(i).unwrap().released);
 
        if all_released {
            escrow.status = EscrowStatus::Released;
        } else {
            // mark as InProgress once first milestone is released
            if escrow.status == EscrowStatus::Locked {
                escrow.status = EscrowStatus::InProgress;
            }
        }
 
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);
 
        // ── Emit milestone_released event ─────────────────────────────────────
 
        env.events().publish(
            (symbol_short!("ms_rel"), client),
            (job_id, milestone_id, payout),
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

        // Transfer funds to freelancer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Released;
        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("released"), client),
            (job_id, escrow.amount),
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

    // ─── Placeholders ─────────────────────────────────────────────────────────

    /// [PLACEHOLDER] Raise a dispute — requires admin resolution.
    /// See ROADMAP.md v2.1 — DAO Governance.
    pub fn raise_dispute(_env: Env, _job_id: String, _caller: Address) {
        panic!("Dispute resolution coming in v2.1 — see ROADMAP.md");
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _},
        Address, Env, String, Vec,
        token::{Client as TokenClient, StellarAssetClient},
    };

    /// Deploy the contract and return (env, contract_client, admin)
    fn setup() -> (Env, MarketPayContractClient<'static>, Address) {
        let env   = Env::default();
        env.mock_all_auths();
        let id    = env.register_contract(None, MarketPayContract);
        let c     = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        (env, c, admin)
    }

     fn deploy_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let sac      = StellarAssetClient::new(env, &token_id.address());
        sac.mint(to, &amount);
        token_id.address()
    }

    fn job(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }
 
    fn desc(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }
 
    fn make_milestones(env: &Env, specs: &[(u32, &str, u32)]) -> Vec<Milestone> {
        let mut v = Vec::new(env);
        for &(id, d, pct) in specs {
            v.push_back(Milestone {
                id,
                description: desc(env, d),
                percentage:  pct,
                released:    false,
            });
        }
        v
    }

    #[test]
    fn test_initialize() {
        let env    = Env::default();
        let id     = env.register_contract(None, MarketPayContract);
        let client = MarketPayContractClient::new(&env, &id);
        let admin  = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_init_panics() {
        let env   = Env::default();
        let id    = env.register_contract(None, MarketPayContract);
        let c     = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        c.initialize(&admin);
    }

    #[test]
    fn test_escrow_count_starts_zero() {
        let env   = Env::default();
        let id    = env.register_contract(None, MarketPayContract);
        let c     = MarketPayContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize(&admin);
        assert_eq!(c.get_escrow_count(), 0);
    }
    
    #[test]
    fn test_create_escrow_with_milestones_success() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones = make_milestones(&env, &[
            (0, "Design mockups",      30),
            (1, "Backend API",         40),
            (2, "Testing & delivery",  30),
        ]);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-001"),
            &client,
            &freelancer,
            &token,
            &1_000_0000000,
            &milestones,
        );
 
        assert_eq!(c.get_escrow_count(), 1);
        let escrow = c.get_escrow(&job(&env, "job-001"));
        assert_eq!(escrow.milestones.len(), 3);
        assert_eq!(escrow.status, EscrowStatus::Locked);
    }
 
    #[test]
    #[should_panic(expected = "Milestone percentages must sum to exactly 100")]
    fn test_milestone_percentages_not_100_rejected() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones = make_milestones(&env, &[
            (0, "Phase 1", 40),
            (1, "Phase 2", 40),   // sum = 80, not 100
        ]);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-002"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
    }
 
    #[test]
    #[should_panic(expected = "Milestone percentages must sum to exactly 100")]
    fn test_milestone_percentages_over_100_rejected() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones = make_milestones(&env, &[
            (0, "Phase 1", 60),
            (1, "Phase 2", 60),   // sum = 120
        ]);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-003"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
    }
 
    #[test]
    #[should_panic(expected = "Must provide 1 to 5 milestones")]
    fn test_too_many_milestones_rejected() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        // 6 milestones, each 16% — also wrong sum, but limit check fires first
        let milestones = make_milestones(&env, &[
            (0, "M0", 17), (1, "M1", 17), (2, "M2", 17),
            (3, "M3", 17), (4, "M4", 17), (5, "M5", 15),
        ]);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-004"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
    }
 
    #[test]
    #[should_panic(expected = "Must provide 1 to 5 milestones")]
    fn test_zero_milestones_rejected() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones: Vec<Milestone> = Vec::new(&env);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-005"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
    }
 
    // ── release first milestone ───────────────────────────────────────────────
 
    #[test]
    fn test_release_first_milestone() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let total      = 1_000_0000000_i128;   // 1000 XLM in stroops
        let token      = deploy_token(&env, &admin, &client, total);
 
        let milestones = make_milestones(&env, &[
            (0, "Phase 1", 25),
            (1, "Phase 2", 75),
        ]);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-010"),
            &client, &freelancer, &token,
            &total, &milestones,
        );
 
        // Release milestone 0 (25%)
        c.release_milestone(&job(&env, "job-010"), &0u32, &client);
 
        // Freelancer should have received 25% of total
        let expected_payout = total * 25 / 100;
        let fl_balance = TokenClient::new(&env, &token).balance(&freelancer);
        assert_eq!(fl_balance, expected_payout);
 
        // Escrow should still be InProgress one milestone remains
        let escrow = c.get_escrow(&job(&env, "job-010"));
        assert_eq!(escrow.status, EscrowStatus::InProgress);
        assert!(escrow.milestones.get(0).unwrap().released);
        assert!(!escrow.milestones.get(1).unwrap().released);
    }
 
    // ── release all milestones ────────────────────────────────────────────────
 
    #[test]
    fn test_release_all_milestones_marks_released() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let total      = 1_000_0000000_i128;
        let token      = deploy_token(&env, &admin, &client, total);
 
        let milestones = make_milestones(&env, &[
            (0, "Design",   30),
            (1, "Build",    40),
            (2, "Delivery", 30),
        ]);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-020"),
            &client, &freelancer, &token,
            &total, &milestones,
        );
 
        c.release_milestone(&job(&env, "job-020"), &0u32, &client);
        c.release_milestone(&job(&env, "job-020"), &1u32, &client);
        c.release_milestone(&job(&env, "job-020"), &2u32, &client);
 
        // All funds transferred to freelancer may be off by rounding
        let fl_balance = TokenClient::new(&env, &token).balance(&freelancer);
        // 30 + 40 + 30 = 100% → full amount
        assert_eq!(fl_balance, total);
 
        // Escrow must be fully Released
        assert_eq!(c.get_status(&job(&env, "job-020")), EscrowStatus::Released);
    }
 
    #[test]
    fn test_partial_release_correct_amounts() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let total      = 500_0000000_i128;   // 500 XLM
        let token      = deploy_token(&env, &admin, &client, total);
 
        // 5 milestones of 20% each
        let milestones = make_milestones(&env, &[
            (0, "M0", 20), (1, "M1", 20), (2, "M2", 20),
            (3, "M3", 20), (4, "M4", 20),
        ]);
 
        c.create_escrow_with_milestones(
            &job(&env, "job-030"),
            &client, &freelancer, &token,
            &total, &milestones,
        );
 
        let token_client = TokenClient::new(&env, &token);
 
        for m_id in 0u32..=4u32 {
            c.release_milestone(&job(&env, "job-030"), &m_id, &client);
            let expected = total * 20 * (m_id as i128 + 1) / 100;
            assert_eq!(token_client.balance(&freelancer), expected);
        }
 
        assert_eq!(c.get_status(&job(&env, "job-030")), EscrowStatus::Released);
    }
 
    // ── guard rails ──────────────────────────────────────────────────────────
 
    #[test]
    #[should_panic(expected = "Escrow is already closed")]
    fn test_double_release_same_milestone_panics() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones = make_milestones(&env, &[(0, "Only", 100)]);
        c.create_escrow_with_milestones(
            &job(&env, "job-040"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
 
        c.release_milestone(&job(&env, "job-040"), &0u32, &client);
        // Second call should panic (escrow is now Released)
        c.release_milestone(&job(&env, "job-040"), &0u32, &client);
    }
 
    #[test]
    #[should_panic(expected = "Only the client can release milestones")]
    fn test_non_client_cannot_release_milestone() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let imposter   = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones = make_milestones(&env, &[(0, "Only", 100)]);
        c.create_escrow_with_milestones(
            &job(&env, "job-050"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
 
        c.release_milestone(&job(&env, "job-050"), &0u32, &imposter);
    }
 
    #[test]
    #[should_panic(expected = "Milestone not found")]
    fn test_invalid_milestone_id_panics() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones = make_milestones(&env, &[(0, "Only", 100)]);
        c.create_escrow_with_milestones(
            &job(&env, "job-060"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
 
        c.release_milestone(&job(&env, "job-060"), &99u32, &client);  // no such id
    }
 
    #[test]
    #[should_panic(expected = "Escrow is already closed")]
    fn test_release_after_full_release_panics() {
        let (env, c, admin) = setup();
        let client     = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token      = deploy_token(&env, &admin, &client, 1_000_0000000);
 
        let milestones = make_milestones(&env, &[
            (0, "Part A", 50),
            (1, "Part B", 50),
        ]);
        c.create_escrow_with_milestones(
            &job(&env, "job-070"),
            &client, &freelancer, &token,
            &1_000_0000000, &milestones,
        );
 
        c.release_milestone(&job(&env, "job-070"), &0u32, &client);
        c.release_milestone(&job(&env, "job-070"), &1u32, &client);
        // Escrow is now Released any further call should panic
        c.release_milestone(&job(&env, "job-070"), &0u32, &client);
    }
}

