# Runbook: Horizon Indexer Lag and Sync Stalls

**Severity:** SEV-1 (On-chain state desynchronisation)  
**Owner:** Backend on-call  
**Related Alerts:** `IndexerLagHigh`, `IndexerSyncStalled`, `IndexerErrorRateHigh`

---

## Summary
The Horizon indexer tracks platform wallet transactions and Soroban contract events (`contract_events` table). If the indexer falls behind Horizon or encounters stream errors, users will not see on-chain payment updates or escrow status transitions.

## Symptoms
- Prometheus alerts `IndexerLagHigh` (lag > 300s) or `IndexerSyncStalled` (status = 0) firing.
- `GET /api/indexer/health` returns `synced: false` or high `lagSeconds`.
- Job statuses in database not transitioning to `funded` or `released` despite confirmed on-chain transactions.

## Diagnostic Steps
1. Query `/api/indexer/health`:
   ```bash
   curl -s http://localhost:4000/api/indexer/health
   ```
2. Check database indexer checkpoint:
   ```sql
   SELECT synced, last_processed_ledger, last_transaction_at, updated_at FROM indexer_state WHERE id = 1;
   ```
3. Check Horizon connectivity and latest ledger:
   ```bash
   curl -s "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1"
   ```
4. Check backend service logs for indexer errors:
   ```bash
   grep '\[Indexer\]' /var/log/marketpay/backend.log
   ```

## Mitigation & Recovery
1. If the indexer stream stalled due to network disconnect, restart the backend container or service.
2. If the cursor is corrupted, manually advance or rewind the cursor in `indexer_state`:
   ```sql
   UPDATE indexer_state SET last_processed_ledger = <valid_ledger>, synced = true WHERE id = 1;
   ```
3. Verify that `PLATFORM_WALLET_ADDRESS` and `CONTRACT_ID` match the deployed contract on the target network.
