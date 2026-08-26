use soroban_sdk::{symbol_short, token, Address, Env, String};

use crate::helpers::check_not_frozen;
use crate::types::*;

/// Raise a dispute — requires admin resolution.
///
/// Issue #437: the caller must lock a configurable bond before the
/// dispute is accepted.  The bond is enforced only when the admin has
/// configured a non-zero bond amount via `set_dispute_bond`; if no
/// configuration is present, this function preserves the legacy
/// zero-cost behaviour so escrows created before #437 continue to
/// function without admin migration.
///
/// Soroban's `caller.require_auth()` authorises every token operation
/// the contract performs on behalf of the caller within this call,
/// so the bond transfer below does NOT need a separate `token.authorize`
/// step.
pub(crate) fn raise_dispute(env: Env, job_id: String, caller: Address) {
    caller.require_auth();
    check_not_frozen(&env);

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.client != caller && escrow.freelancer != caller {
        panic!("Only participants can raise a dispute");
    }

    if escrow.status == EscrowStatus::Released
        || escrow.status == EscrowStatus::Refunded
        || escrow.status == EscrowStatus::Frozen
        || escrow.status == EscrowStatus::Disputed
    {
        panic!("Cannot dispute a resolved, frozen, or already-disputed escrow");
    }

    // Optional bond requirement (Issue #437).  When the admin has not
    // configured a dispute bond this block is a no-op and the function
    // falls through to the legacy behaviour preserved for backward
    // compatibility with pre-#437 escrows and tests.
    if let Some(bond_cfg) = env
        .storage()
        .instance()
        .get::<_, DisputeBondConfig>(&DataKey::DisputeBondConfig)
    {
        // Snapshot the bond into per-job storage FIRST so that an event
        // consumer / indexer never sees a `bond_lck` event for which
        // there is no recoverable record.  We update the escrow status
        // and persist everything before performing the external token
        // transfer so that storage state is always the truth.
        env.storage().instance().set(
            &DataKey::DisputeBond(job_id.clone()),
            &DisputeBond {
                caller: caller.clone(),
                token: bond_cfg.token.clone(),
                amount: bond_cfg.amount,
                raised_at_ledger: env.ledger().sequence(),
            },
        );

        escrow.status = EscrowStatus::Disputed;
        env.storage()
            .instance()
            .set(&DataKey::Escrow(job_id.clone()), &escrow);

        // Lock the bond.  `caller.require_auth()` above has already
        // authorised ALL token operations from this caller, so this
        // single transfer call covers the bond lock.
        let bond_token_client = token::Client::new(&env, &bond_cfg.token);
        let contract_address = env.current_contract_address();
        bond_token_client.transfer(&caller, &contract_address, &bond_cfg.amount);

        env.events().publish(
            (symbol_short!("bond_lck"), job_id.clone()),
            (caller.clone(), bond_cfg.token, bond_cfg.amount),
        );
        env.events().publish(
            (symbol_short!("escrow_ds"), job_id.clone()),
            (
                escrow.client.clone(),
                escrow.freelancer.clone(),
                caller.clone(),
            ),
        );
        return;
    }

    // Legacy fallback (zero-cost dispute mode).
    escrow.status = EscrowStatus::Disputed;
    env.storage()
        .instance()
        .set(&DataKey::Escrow(job_id.clone()), &escrow);

    env.events().publish(
        (symbol_short!("escrow_ds"), job_id.clone()),
        (
            escrow.client.clone(),
            escrow.freelancer.clone(),
            caller.clone(),
        ),
    );
}

/// Resolve a disputed escrow with a split-percentage payout and settle
/// the dispute bond (Issue #437).
///
/// `winner` is the party that prevails in the dispute — they receive
/// `split_percentage`% of the escrow amount, and the other party receives
/// `(100 - split_percentage)`%.
///
/// `winner` must be either the client or the freelancer on the escrow.
/// `split_percentage` must be between 0 and 100 inclusive.
///
/// The locked dispute bond (if any) is returned to the bond-caller if
/// they are the winner, or slashed to the winner if the bond-caller
/// is the losing party.
///
/// **Arbitrator-only.**  Idempotency is enforced via `DisputeBond`
/// storage which is removed after settlement, so a second call panics.
pub(crate) fn resolve_dispute(
    env: Env,
    job_id: String,
    arbitrator: Address,
    winner: Address,
    split_percentage: u32,
) {
    arbitrator.require_auth();
    check_not_frozen(&env);

    // ── Only the designated arbitrator may call this function ──────────────
    let stored_arbitrator: Address = env
        .storage()
        .instance()
        .get(&DataKey::ArbitratorAddress)
        .expect("No arbitrator configured");
    if stored_arbitrator != arbitrator {
        panic!("Only the arbitrator can resolve a dispute");
    }

    if split_percentage > 100 {
        panic!("Split percentage must be between 0 and 100");
    }

    let mut escrow: Escrow = env
        .storage()
        .instance()
        .get(&DataKey::Escrow(job_id.clone()))
        .expect("Escrow not found");

    if escrow.status != EscrowStatus::Disputed {
        panic!("Escrow is not in Disputed state");
    }

    if winner != escrow.client && winner != escrow.freelancer {
        panic!("Winner must be the client or the freelancer");
    }

    // Determine loser
    let loser: Address = if winner == escrow.client {
        escrow.freelancer.clone()
    } else {
        escrow.client.clone()
    };

    // Calculate split amounts
    let winner_amount = escrow
        .amount
        .checked_mul(split_percentage as i128)
        .expect("Arithmetic overflow")
        .checked_div(100)
        .expect("Arithmetic overflow");
    let loser_amount = escrow
        .amount
        .checked_sub(winner_amount)
        .expect("Arithmetic underflow");

    // Update escrow status and clean up stale keys BEFORE external transfers
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

    // Pay out the escrow principal — split between winner and loser
    let escrow_token_client = token::Client::new(&env, &escrow.token);
    if winner_amount > 0 {
        escrow_token_client.transfer(&env.current_contract_address(), &winner, &winner_amount);
    }
    if loser_amount > 0 {
        escrow_token_client.transfer(&env.current_contract_address(), &loser, &loser_amount);
    }

    // Pull snapshot of the locked bond (may be absent if zero-cost mode).
    let bond: Option<DisputeBond> = env
        .storage()
        .instance()
        .get(&DataKey::DisputeBond(job_id.clone()));

    // Settle the bond — caller-wins returns it, caller-loses slashes it.
    if let Some(b) = bond.clone() {
        let bond_token_client = token::Client::new(&env, &b.token);
        if b.caller == winner {
            // Bond-caller is the winner → return bond
            bond_token_client.transfer(&env.current_contract_address(), &b.caller, &b.amount);
            env.events().publish(
                (symbol_short!("bond_rtn"), job_id.clone()),
                (b.caller.clone(), b.amount),
            );
        } else {
            // Bond-caller lost → slash bond to winner
            bond_token_client.transfer(&env.current_contract_address(), &winner, &b.amount);
            env.events().publish(
                (symbol_short!("bond_slsh"), job_id.clone()),
                (winner.clone(), b.amount),
            );
        }
        // Consume the bond record so a second resolve_dispute panics
        env.storage()
            .instance()
            .remove(&DataKey::DisputeBond(job_id.clone()));
    }

    // Emit DisputeResolved event
    env.events().publish(
        (symbol_short!("dsp_res"), job_id.clone()),
        (
            arbitrator.clone(),
            winner.clone(),
            loser.clone(),
            winner_amount,
            loser_amount,
        ),
    );
}

/// Admin sets the global dispute bond configuration (Issue #437).
///
/// `amount == 0` and an `Option::None` (key absent) both leave the
/// contract in **legacy zero-cost mode** so existing escrows and tests
/// continue to operate without modification.  Setting a positive amount
/// enables the bond requirement for all SUBSEQUENT disputes (existing
/// disputes are unaffected — bonds are snapshotted at lock time).
pub(crate) fn set_dispute_bond(env: Env, admin: Address, token: Address, amount: i128) {
    admin.require_auth();

    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Not initialized");
    if stored_admin != admin {
        panic!("Only admin can update the dispute bond");
    }
    if amount <= 0 {
        panic!("Bond amount must be positive");
    }

    env.storage().instance().set(
        &DataKey::DisputeBondConfig,
        &DisputeBondConfig {
            token: token.clone(),
            amount,
        },
    );

    env.events()
        .publish((symbol_short!("bond_cfg"), admin), (token, amount));
}

/// Read the global dispute bond configuration.  Returns `(None, 0)` in
/// legacy zero-cost mode (key absent).
pub(crate) fn get_dispute_bond_config(env: Env) -> (Option<Address>, i128) {
    env.storage()
        .instance()
        .get::<_, DisputeBondConfig>(&DataKey::DisputeBondConfig)
        .map(|c| (Some(c.token), c.amount))
        .unwrap_or((None, 0))
}

/// Read the per-job locked bond record.  Returns `None` if no bond
/// was locked (either legacy zero-cost mode or already settled).
pub(crate) fn get_dispute_bond(env: Env, job_id: String) -> Option<DisputeBond> {
    env.storage().instance().get(&DataKey::DisputeBond(job_id))
}
