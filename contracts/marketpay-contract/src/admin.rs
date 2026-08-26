use soroban_sdk::{symbol_short, Address, BytesN, Env, String, Vec};

use crate::types::*;

/// Initialize the contract. Sets the admin and default configuration.
///
/// This can only be called once. Attempting to re-initialize will panic.
pub(crate) fn initialize(env: Env, admin: Address, treasury_address: Address) {
    if env.storage().instance().has(&DataKey::Admin) {
        panic!("Already initialized");
    }
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage()
        .instance()
        .set(&DataKey::TreasuryAddress, &treasury_address);
    env.storage()
        .instance()
        .set(&DataKey::PlatformFeeBps, &100u32);
    env.storage().instance().set(&DataKey::EscrowCount, &0u32);
    env.storage()
        .instance()
        .set(&DataKey::DefaultTimeoutSeconds, &DEFAULT_TIMEOUT_SECONDS);
    env.storage().instance().set(&DataKey::Version, &1u32);

    let mut admins: Vec<Address> = Vec::new(&env);
    admins.push_back(admin);
    env.storage().instance().set(&DataKey::Admins, &admins);
    env.storage()
        .instance()
        .set(&DataKey::UnfreezeThreshold, &2u32);
    env.storage().instance().set(&DataKey::Frozen, &false);
}

// ─── Upgrade & versioning ─────────────────────────────────────────────────

/// Upgrade the contract WASM. Restricted to admin.
///
/// `new_wasm_hash` is the 32-byte hash of the new WASM blob already
/// uploaded to the network via `stellar contract install`.
/// All existing storage (escrows, proposals, ratings, …) is preserved
/// because Soroban upgrades only replace the executable, not the state.
pub(crate) fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
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
pub(crate) fn get_version(env: Env) -> u32 {
    env.storage().instance().get(&DataKey::Version).unwrap_or(1)
}

// ─── Getters ─────────────────────────────────────────────────────────────

/// Get the full escrow record for a job.
pub(crate) fn get_escrow(env: Env, job_id: String) -> Escrow {
    env.storage()
        .instance()
        .get(&DataKey::Escrow(job_id))
        .expect("Escrow not found")
}

/// Get escrow status for a job.
pub(crate) fn get_status(env: Env, job_id: String) -> EscrowStatus {
    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id))
        .expect("Escrow not found");
    escrow.status
}

/// Get timeout ledger for a job.
pub(crate) fn get_timeout_ledger(env: Env, job_id: String) -> u32 {
    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id))
        .expect("Escrow not found");
    escrow.timeout_ledger
}

/// Get the timestamp after which `timeout_refund()` becomes available.
pub(crate) fn get_timeout_timestamp(env: Env, job_id: String) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::TimeoutTimestamp(job_id))
        .unwrap_or(0)
}

/// Get a single milestone from an escrow by index.
pub(crate) fn get_milestone(env: Env, job_id: String, index: u32) -> Milestone {
    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id))
        .expect("Escrow not found");
    if index >= escrow.milestones.len() {
        panic!("Milestone index out of bounds");
    }
    escrow.milestones.get(index).unwrap()
}

/// Check whether the contract is globally frozen.
pub(crate) fn is_frozen(env: Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Frozen)
        .unwrap_or(false)
}

/// Get the referrer address for a job's escrow, if one was set.
pub(crate) fn get_referrer(env: Env, job_id: String) -> Option<Address> {
    let escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id))
        .expect("Escrow not found");
    escrow.referrer
}

/// Get total number of escrows created.
pub(crate) fn get_escrow_count(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::EscrowCount)
        .unwrap_or(0)
}

/// Get the contract admin.
pub(crate) fn get_admin(env: Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized")
}

/// Get the treasury address that receives platform fees.
pub(crate) fn get_treasury_address(env: Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TreasuryAddress)
        .expect("Treasury not set")
}

/// Get the platform fee in basis points (e.g. 100 = 1%).
pub(crate) fn get_platform_fee_bps(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::PlatformFeeBps)
        .unwrap_or(0)
}

// ─── Arbitrator Management ────────────────────────────────────────────

/// Set the arbitrator address that can resolve disputes.
/// Only callable by the contract admin.
pub(crate) fn set_arbitrator(env: Env, admin: Address, arbitrator: Address) {
    admin.require_auth();

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    if stored_admin != admin {
        panic!("Only admin can set the arbitrator");
    }

    env.storage()
        .instance()
        .set(&DataKey::ArbitratorAddress, &arbitrator);

    env.events()
        .publish((symbol_short!("arb_set"), admin), arbitrator);
}

/// Get the current arbitrator address.  Returns `None` if not set.
pub(crate) fn get_arbitrator(env: Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::ArbitratorAddress)
}

/// Update the treasury address. Only callable by admin.
pub(crate) fn set_treasury_address(env: Env, admin: Address, treasury_address: Address) {
    admin.require_auth();

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    if stored_admin != admin {
        panic!("Only admin can set treasury address");
    }

    env.storage()
        .instance()
        .set(&DataKey::TreasuryAddress, &treasury_address);
    env.events()
        .publish((symbol_short!("set_tres"), admin), treasury_address);
}

/// Update the platform fee in basis points. Only callable by admin.
/// `bps` must be ≤ 1000 (10 %).
pub(crate) fn set_platform_fee_bps(env: Env, admin: Address, bps: u32) {
    admin.require_auth();

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    if stored_admin != admin {
        panic!("Only admin can set platform fee");
    }
    if bps > 1000 {
        panic!("Platform fee cannot exceed 10% (1000 bps)");
    }

    env.storage().instance().set(&DataKey::PlatformFeeBps, &bps);
    env.events().publish((symbol_short!("set_fee"), admin), bps);
}

/// Get the current global timeout in seconds.
pub(crate) fn get_default_timeout_seconds(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::DefaultTimeoutSeconds)
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
}

/// Issue #440 — look up the admin-set cap on referrer bonus payouts.
/// Returns `None` when no cap has been set (legacy behaviour: 2% of
/// `release_amount` always applies).
pub(crate) fn get_max_referrer_bonus_xlm(env: Env) -> Option<i128> {
    env.storage().instance().get(&DataKey::MaxReferrerBonusXlm)
}

/// Issue #440 — admin sets the maximum referrer bonus (in token
/// stroops, i.e. same units as escrow amounts). Pass `0` to disable
/// the referrer program entirely; pass a positive value to cap
/// every release's referrer-ledger entry at that amount.
///
/// The cap is consumed at `release_escrow_core()` time so existing
/// escrows that have not yet been released pick up the new cap on
/// their first release. For milestone escrows each partial
/// `release_milestone` call applies the cap independently to that
/// release's payout — a 5-milestone escrow with cap = 10 XLM pays
/// the cap up to 5 times, not once cumulatively.
pub(crate) fn set_max_referrer_bonus_xlm(env: Env, admin: Address, cap: i128) {
    admin.require_auth();

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    if stored_admin != admin {
        panic!("Only admin can set the referrer bonus cap");
    }
    if cap < 0 {
        panic!("Referrer bonus cap must be non-negative");
    }

    env.storage()
        .instance()
        .set(&DataKey::MaxReferrerBonusXlm, &cap);
    env.events().publish((symbol_short!("ref_cap"), admin), cap);
}

/// Update the global timeout in seconds.
///
/// This acts as the governance/admin override for new escrows.
pub(crate) fn set_default_timeout_seconds(env: Env, admin: Address, timeout_seconds: u32) {
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

/// Admin freezes the entire contract — all state-mutating operations are
/// blocked until unfreeze_contract() is called with enough admin signatures.
///
/// Any admin in the stored admin list may call this function.
pub(crate) fn freeze_contract(env: Env, admin: Address) {
    admin.require_auth();

    let admins: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::Admins)
        .expect("Not initialized");

    if !admins.contains(&admin) {
        panic!("Only an admin can freeze the contract");
    }

    env.storage().instance().set(&DataKey::Frozen, &true);

    env.events().publish((symbol_short!("frozen"), admin), true);
}

/// Unfreeze the contract — requires M-of-N admin signatures.
///
/// `admins` must contain at least `UnfreezeThreshold` distinct admin
/// addresses, each of which must also authorize the call via `require_auth`.
/// The addresses in `admins` must all be present in the stored admin list.
pub(crate) fn unfreeze_contract(env: Env, admins: Vec<Address>) {
    let threshold: u32 = env
        .storage()
        .instance()
        .get(&DataKey::UnfreezeThreshold)
        .expect("Not initialized");

    if admins.len() < threshold {
        panic!("Insufficient admin signatures to unfreeze");
    }

    let stored_admins: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::Admins)
        .expect("Not initialized");

    for admin in admins.iter() {
        admin.require_auth();
        if !stored_admins.contains(&admin) {
            panic!("One of the provided addresses is not an admin");
        }
    }

    // De-duplication guard: every admin in `admins` must be distinct.
    let mut seen: Vec<Address> = Vec::new(&env);
    for admin in admins.iter() {
        if seen.contains(&admin) {
            panic!("Duplicate admin in unfreeze signatures");
        }
        seen.push_back(admin);
    }

    let was_frozen: bool = env
        .storage()
        .instance()
        .get(&DataKey::Frozen)
        .unwrap_or(false);

    if !was_frozen {
        panic!("Contract is not frozen");
    }

    env.storage().instance().set(&DataKey::Frozen, &false);

    env.events()
        .publish((symbol_short!("unfroz"), threshold), admins.len());
}

/// Add a new admin address to the multi-sig admin list.
/// Requires auth from an existing admin.
pub(crate) fn add_admin(env: Env, admin: Address, new_admin: Address) {
    admin.require_auth();

    let mut admins: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::Admins)
        .expect("Not initialized");

    if !admins.contains(&admin) {
        panic!("Only an admin can add new admins");
    }
    if admins.contains(&new_admin) {
        panic!("Address is already an admin");
    }

    admins.push_back(new_admin);
    env.storage().instance().set(&DataKey::Admins, &admins);
}

/// Update the unfreeze threshold (the M in M-of-N).
/// Requires auth from an existing admin.
pub(crate) fn set_unfreeze_threshold(env: Env, admin: Address, threshold: u32) {
    admin.require_auth();

    let admins: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::Admins)
        .expect("Not initialized");

    if !admins.contains(&admin) {
        panic!("Only an admin can update the threshold");
    }
    if threshold == 0 || threshold > admins.len() {
        panic!("Threshold must be between 1 and the number of admins");
    }

    env.storage()
        .instance()
        .set(&DataKey::UnfreezeThreshold, &threshold);
}

/// Return the list of admin addresses.
pub(crate) fn get_admins(env: Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Admins)
        .expect("Not initialized")
}

/// Return the unfreeze threshold.
pub(crate) fn get_unfreeze_threshold(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::UnfreezeThreshold)
        .unwrap_or(2)
}
