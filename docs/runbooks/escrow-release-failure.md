# Runbook: Escrow Release Failures

**Severity:** SEV-1 (Funds delivery failure)  
**Owner:** Backend on-call  
**Related Alerts:** `EscrowReleaseErrorRateHigh`

---

## Summary
More than 5% of escrow release attempts have failed over the last 5 minutes.

## Diagnostic Steps
1. Query `marketpay_escrow_release_errors_total` by `reason` (insufficient_balance, network, not_found, contract_error).
2. Check platform wallet XLM and asset balance on Horizon.
3. Check Soroban contract logs for contract execution errors.

## Mitigation
1. Fund platform distribution wallet if `insufficient_balance`.
2. Inspect Horizon RPC status if `network`.
3. Check contract state if `contract_error`.
