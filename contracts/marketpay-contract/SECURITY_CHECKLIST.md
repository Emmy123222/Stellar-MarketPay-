# Soroban Smart Contract Security Audit Checklist

This checklist is designed to help auditors and developers identify common vulnerabilities in Soroban smart contracts.

## 1. Reentrancy
- [ ] Ensure that state changes occur before external calls (Checks-Effects-Interactions pattern).
- [ ] Use reentrancy guards if necessary.
- [ ] Verify that cross-contract calls do not allow the called contract to re-enter the caller.

## 2. Integer Overflow and Underflow
- [ ] Use `checked_add`, `checked_sub`, `checked_mul`, and `checked_div` for all arithmetic operations.
- [ ] Verify that large values cannot cause overflow during intermediate calculations.

## 3. Authorization Bypass
- [ ] Verify that `require_auth()` or `require_auth_for_args()` is called for all sensitive functions.
- [ ] Ensure that the `Address` being authorized is the correct one (e.g., the owner or a specific participant).
- [ ] Check for "shadow" authorization where an attacker might use their own address instead of the intended one.

## 4. Replay Attacks
- [ ] Ensure that signatures or nonces are used correctly to prevent transactions from being replayed.
- [ ] Soroban's built-in auth handles many replay concerns, but custom signature logic must be audited carefully.

## 5. Denial of Service (DoS)
- [ ] Avoid unbounded loops that could exceed budget limits.
- [ ] Be cautious with operations that depend on user-provided data size.
- [ ] Ensure that a single user cannot block the entire contract's functionality.

## 6. Access Control
- [ ] Verify that only authorized roles can perform administrative actions (e.g., updating parameters, withdrawing funds).
- [ ] Check for missing access control on critical functions.

## 7. Data Validation
- [ ] Validate all inputs from external sources.
- [ ] Ensure that strings, vectors, and other data structures have reasonable size limits.

## 8. Front-Running
- [ ] Consider the impact of transaction ordering on the contract's logic.
- [ ] Use commit-reveal schemes or other techniques if front-running is a significant risk.

## 9. Upgradeability
- [ ] If the contract is upgradeable, ensure that the upgrade mechanism is secure and controlled by a trusted entity.
- [ ] Verify that state is preserved correctly during upgrades.

## 10. Logic Errors
- [ ] Review the contract's business logic against its specifications.
- [ ] Check for off-by-one errors, incorrect conditionals, and other common programming mistakes.

## 11. Resource Limits (Budget)
- [ ] Monitor CPU and memory usage to ensure the contract stays within Soroban's limits.
- [ ] Optimize expensive operations.

## 12. Error Handling
- [ ] Use `panic!` or `Error` types to handle unexpected states gracefully.
- [ ] Ensure that errors do not leave the contract in an inconsistent state.
