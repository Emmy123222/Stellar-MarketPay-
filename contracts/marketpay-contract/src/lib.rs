/**
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
    token, Address, Env, Symbol, symbol_short, String,
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

    // ─── Milestones ───────────────────────────────────────────────────────────

    /// Client releases a specific milestone payment to the freelancer.
    pub fn release_milestone(env: Env, job_id: String, milestone_index: u32, client: Address) {
        client.require_auth();

        let mut escrow: Escrow = env.storage().instance()
            .get(&DataKey::Escrow(job_id.clone()))
            .expect("Escrow not found");

        if escrow.client != client {
            panic!("Only the client can release milestones");
        }
        if escrow.status != EscrowStatus::InProgress {
            panic!("Work must be in progress to release milestones");
        }
        
        let mut milestones = escrow.milestones.clone();
        if milestone_index >= milestones.len() {
            panic!("Invalid milestone index");
        }

        let mut milestone = milestones.get(milestone_index).unwrap();
        if milestone.is_completed {
            panic!("Milestone already completed");
        }

        // Transfer milestone amount to freelancer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &milestone.amount,
        );

        // Update milestone status
        milestone.is_completed = true;
        milestones.set(milestone_index, milestone.clone());
        escrow.milestones = milestones;

        // If all milestones are completed, mark escrow as released
        let mut all_done = true;
        for ms in escrow.milestones.iter() {
            if !ms.is_completed {
                all_done = false;
                break;
            }
        }
        if all_done {
            escrow.status = EscrowStatus::Released;
        }

        env.storage().instance().set(&DataKey::Escrow(job_id.clone()), &escrow);

        env.events().publish(
            (symbol_short!("ms_paid"), client),
            (job_id, milestone.amount),
        );
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
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

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
}
