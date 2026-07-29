/*
 * contracts/certora/escrow.spec
 *
 * Certora Verification Language (CVL) specification for Stellar MarketPay Escrow Contract.
 *
 * This spec formally verifies:
 *   1. Invariant A: Total Locked Funds Consistency
 *   2. Invariant B: No Double Release & Irreversibility
 *   3. Invariant C: Authorization Safety (Only client can release/refund/partial-release)
 */

methods {
    // Lifecycle functions
    function create_escrow(string job_id, address client, CreateEscrowParams params) expect void;
    function create_escrow_with_deliverable(string job_id, address client, CreateEscrowParams params, bytes32 deliverable_hash) expect void;
    function start_work(string job_id, address client) expect void;
    function release_escrow(string job_id, address client) expect void;
    function release_with_conversion(string job_id, address client, address target_token, int128 min_amount_out) expect void;
    function refund_escrow(string job_id, address client) expect void;
    function timeout_refund(string job_id, address client) expect void;
    function partial_release(string job_id, uint32 milestone_index, address client) expect void;
    
    // View/Getter functions (marked envfree if they don't access Env block/timestamp)
    function get_status(string job_id) returns uint8 envfree;
    function get_escrow(string job_id) returns Escrow envfree;
    function get_timeout_ledger(string job_id) returns uint32 envfree;
    function get_timeout_timestamp(string job_id) returns uint32 envfree;
    function get_escrow_count() returns uint32 envfree;
}

// ─── Status Constants Matching EscrowStatus Enum ────────────────────────────
definition STATUS_LOCKED()      returns uint8 = 0; // Locked
definition STATUS_IN_PROGRESS() returns uint8 = 1; // InProgress
definition STATUS_RELEASED()    returns uint8 = 2; // Released
definition STATUS_REFUNDED()    returns uint8 = 3; // Refunded
definition STATUS_DISPUTED()    returns uint8 = 4; // Disputed

// ─── Invariant A: Total Locked Funds Consistency ─────────────────────────────
// We use a ghost sum to track the mathematical total of active escrows.
ghost math::sum total_locked {
    init_state => total_locked == 0;
}

// Rule: Creating an escrow increases total_locked by the escrow amount.
rule total_locked_increases_on_create {
    env e;
    string job_id;
    address client;
    CreateEscrowParams params;
    
    require params.amount > 0;
    
    math::sum total_locked_before = total_locked;
    
    create_escrow(e, job_id, client, params);
    
    math::sum total_locked_after = total_locked;
    assert total_locked_after == total_locked_before + params.amount;
}

// Rule: Releasing an escrow completely reduces total_locked by the escrow's total amount.
rule total_locked_decreases_on_release {
    env e;
    string job_id;
    address client;
    
    uint8 status = get_status(job_id);
    require (status == STATUS_LOCKED() || status == STATUS_IN_PROGRESS());
    
    Escrow escrow = get_escrow(job_id);
    int128 amount = escrow.amount;
    
    math::sum total_locked_before = total_locked;
    
    release_escrow(e, job_id, client);
    
    math::sum total_locked_after = total_locked;
    assert total_locked_after == total_locked_before - amount;
}

// Rule: Refunding an escrow reduces total_locked by the escrow's total amount.
rule total_locked_decreases_on_refund {
    env e;
    string job_id;
    address client;
    
    uint8 status = get_status(job_id);
    require status == STATUS_LOCKED();
    
    Escrow escrow = get_escrow(job_id);
    int128 amount = escrow.amount;
    
    math::sum total_locked_before = total_locked;
    
    refund_escrow(e, job_id, client);
    
    math::sum total_locked_after = total_locked;
    assert total_locked_after == total_locked_before - amount;
}

// Rule: Timeout refund reduces total_locked by the escrow's total amount.
rule total_locked_decreases_on_timeout_refund {
    env e;
    string job_id;
    address client;
    
    uint8 status = get_status(job_id);
    require status == STATUS_LOCKED();
    
    Escrow escrow = get_escrow(job_id);
    int128 amount = escrow.amount;
    
    math::sum total_locked_before = total_locked;
    
    timeout_refund(e, job_id, client);
    
    math::sum total_locked_after = total_locked;
    assert total_locked_after == total_locked_before - amount;
}


// ─── Invariant B: No Double Release & Irreversibility ──────────────────────────

// Rule: A released escrow cannot be released again.
rule escrow_cannot_release_twice {
    env e;
    string job_id;
    address client;
    
    require get_status(job_id) == STATUS_RELEASED();
    
    release_escrow@withrevert(e, job_id, client);
    assert lastReverted;
}

// Rule: A released escrow cannot be released with conversion again.
rule escrow_cannot_release_with_conversion_twice {
    env e;
    string job_id;
    address client;
    address target_token;
    int128 min_amount_out;
    
    require get_status(job_id) == STATUS_RELEASED();
    
    release_with_conversion@withrevert(e, job_id, client, target_token, min_amount_out);
    assert lastReverted;
}

// Rule: A released escrow state is irreversible and cannot be refunded or changed.
rule released_state_is_irreversible {
    env e;
    string job_id;
    method f;
    
    require get_status(job_id) == STATUS_RELEASED();
    
    calleffects f(e, ...);
    
    assert get_status(job_id) == STATUS_RELEASED();
}


// ─── Invariant C: Authorization Safety ────────────────────────────────────────

// Rule: Only the escrow's client can successfully release the escrow.
rule only_client_can_release {
    env e;
    string job_id;
    address caller;
    
    Escrow escrow = get_escrow(job_id);
    require caller != escrow.client;
    
    release_escrow@withrevert(e, job_id, caller);
    assert lastReverted;
}

// Rule: Only the escrow's client can successfully release the escrow with conversion.
rule only_client_can_release_with_conversion {
    env e;
    string job_id;
    address caller;
    address target_token;
    int128 min_amount_out;
    
    Escrow escrow = get_escrow(job_id);
    require caller != escrow.client;
    
    release_with_conversion@withrevert(e, job_id, caller, target_token, min_amount_out);
    assert lastReverted;
}

// Rule: Only the escrow's client can successfully request a refund.
rule only_client_can_refund {
    env e;
    string job_id;
    address caller;
    
    Escrow escrow = get_escrow(job_id);
    require caller != escrow.client;
    
    refund_escrow@withrevert(e, job_id, caller);
    assert lastReverted;
}

// Rule: Only the escrow's client can successfully claim a timeout refund.
rule only_client_can_timeout_refund {
    env e;
    string job_id;
    address caller;
    
    Escrow escrow = get_escrow(job_id);
    require caller != escrow.client;
    
    timeout_refund@withrevert(e, job_id, caller);
    assert lastReverted;
}

// Rule: Only the escrow's client can successfully partial-release a milestone.
rule only_client_can_partial_release {
    env e;
    string job_id;
    uint32 milestone_index;
    address caller;
    
    Escrow escrow = get_escrow(job_id);
    require caller != escrow.client;
    
    partial_release@withrevert(e, job_id, milestone_index, caller);
    assert lastReverted;
}
