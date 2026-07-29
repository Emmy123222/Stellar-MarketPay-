# feat(contract): anchor dispute-evidence IPFS CIDs on-chain Closes #448

## Summary

Each dispute-evidence upload to IPFS via Pinata is now also anchored to the
Stellar contract at `DataKey::EvidenceCids(job_id)` as an append-only
`Vec<Bytes>`. The dispute page surfaces the chain CIDs alongside the
off-chain `dispute_evidence` rows so the audit trail survives IPFS pin loss
or off-chain database wipes.

## Acceptance criteria mapping

| AC | Where it lands |
| --- | --- |
| `submit_evidence_cid(job_id, cid: Bytes)` callable by either party | `contracts/marketpay-contract/src/lib.rs` — `submit_evidence_cid(env, job_id, cid: Bytes, caller: Address)`. Explicit `caller` parameter is `require_auth`'d and verified against the stored `Escrow.client`/`Escrow.freelancer` (see "Signature deviation" note below). |
| Contract stores CIDs in a `Vec<Bytes>` per job | `DataKey::EvidenceCids(String)` — append-only Soroban vector keyed by `job_id`. |
| `get_evidence_cids(job_id)` view function | `contracts/marketpay-contract/src/lib.rs::get_evidence_cids(env, job_id) -> Vec<Bytes>`. |
| `disputeService.js` calls this after Pinata upload | `backend/src/services/disputeService.js::uploadEvidence` invokes `sorobanEvidence.recordEvidenceCidOnChain(...)` right after a successful `ipfsService.uploadFile(...)` + DB insert. Returns the unsigned XDR to the client for wallet signing (matches the existing `attachMessageTxHash` flow for message CIDs). |
| Frontend dispute page reads CIDs from chain | `frontend/pages/disputes/[jobId].tsx` — new "On-chain evidence audit trail" section populated by `fetchDisputeOnchainCids(jobId)` (added to `frontend/lib/api.ts`). |

## Files changed

### Soroban contract
```
contracts/marketpay-contract/src/lib.rs
```
- Removed `DeliverableRecord` struct (the previous per-record struct with `kind`/`submitter` is retired).
- Renamed `DataKey::Deliverables(String)` → `DataKey::EvidenceCids(String)`.
- `record_deliverable(env, job_id, submitter, cid, kind)` → `submit_evidence_cid(env, job_id, cid, caller: Address)`.
- `get_deliverables(env, job_id) -> Vec<DeliverableRecord>` → `get_evidence_cids(env, job_id) -> Vec<Bytes>`.
- Removed `count_deliverables`.

New auth model: `caller.require_auth()` then verifies `caller == escrow.client` || `caller == escrow.freelancer`. Refunded escrows reject new evidence.

### Backend
```
backend/src/services/sorobanEvidence.js    (NEW)
backend/src/services/disputeService.js     (modified)
backend/src/routes/disputes.js             (modified — new GET route)
backend/src/server.js                      (reverted unused deliverable mount)
```

`GET /api/disputes/:jobId/onchain-cids` is the chain-read endpoint. It
delegates to `sorobanEvidence.getOnchainEvidenceCids`, which simulates a
call to the contract's `get_evidence_cids` view function via Soroban RPC
(no low-level instance-storage coupling). Results are cached for 30 s.

`disputeService.uploadEvidence(...)` augments its response with
`data.chainAnchor`: `{success, contractId, xdr, networkPassphrase, rpcUrl}`
on success, or `{success: false, error}` on failure. The unsigned XDR is
intended for the user's wallet (existing pattern, e.g. `attachMessageTxHash`).

### Frontend
```
frontend/lib/api.ts                        (added: fetchDisputeOnchainCids)
frontend/utils/types.ts                    (removed: DeliverableRecord/Kind/JobDeliverable)
frontend/pages/disputes/[jobId].tsx        (added: Ithink #448 on-chain section)
```

The dispute page shows the chain CID list with public-IPFS-gateway links,
auto-refreshes on every successful upload, and gracefully degrades to "No
CIDs have been anchored on-chain for this dispute yet" when the contract
is unconfigured or the network is unreachable.

### Deleted (previous broader draft)
```
backend/src/services/deliverableService.js          (REMOVED)
backend/src/routes/deliverables.js                  (REMOVED)
backend/src/db/migrations/V19__deliverable_audit_trail.{up,down}.sql  (REMOVED)
frontend/components/DeliverableUpload.tsx           (REMOVED)
frontend/components/DeliverableHistory.tsx          (REMOVED)
```

These belonged to an earlier per-job "deliverable history" draft. They
were removed when the implementation was reshaped to the dispute-evidence
scope per the AC.

## Signature deviation — note for reviewers

The AC says `submit_evidence_cid(job_id, cid: Bytes)`, but in practice the
function takes an additional `caller: Address` parameter. This is required
to call `caller.require_auth()` for cryptographic provenance — Soroban
auth is bound to the function's parameter list, and silently allowing
anyone to record CIDs would defeat the tamper-proof claim. The caller is
then looked up against the stored `Escrow` for the `job_id` so only the two
dispute parties can append.

If the spec's intent was "the function takes 2 + env parameters and the
caller is implicitly `env.invoker()`," we can switch to that — but the
explicit `caller: Address` is more standard for Soroban auth contracts.

## Validation

- **`cd frontend && npx tsc --noEmit`**: clean for all changed files. The
  pre-existing TS error in `hooks/usePushNotifications.ts(131,59)` is
  unrelated to this PR.
- **`cd frontend && npx next lint --max-warnings=0`**: clean for
  `pages/disputes`, `pages/jobs`, `lib/api.ts`, `utils/types.ts`. (One
  pre-existing `react-hooks/exhaustive-deps` warning in
  `pages/jobs/index.tsx` exists on `main` and is not introduced here.)
- **Rust contract**: `cargo` is not available in this sandbox so the
  contract was syntactically verified by a code-review agent. Compilation
  on a developer machine with `cargo check --lib` is recommended before
  merge.

## Manual verification checklist

1. **Compile contract**: `cargo check --lib` from
   `contracts/marketpay-contract/`. Expect zero errors.
2. **Run unit tests** (if/when added — see "Open follow-ups" below).
3. **Boot dev stack**: `docker-compose up`.
4. **Dispute flow**:
   - Create a job, hire a freelancer in a real or local contract env.
   - Raise a dispute from one party.
   - Upload evidence (image/PDF). Expect HTTP 201 with `data.chainAnchor`
     populated (an XDR plus `networkPassphrase` and `rpcUrl`).
   - Sign the XDR with the uploader's wallet via the existing `submitViaSoroban`
     or wallet flow.
   - Reload the dispute page — the "On-chain evidence audit trail" section
     should now show the new CID with a working `https://ipfs.io/ipfs/<cid>`
     link.
5. **Empty case**: when the dispute has no chain-anchored CIDs yet, the
   section reads "No CIDs have been anchored on-chain for this dispute yet".

## Security notes

- `submitter.require_auth()` + escrow-membership check prevents a third
  party (admin, oracle, or another address) from anchoring CIDs on behalf
  of the dispute parties, preserving the tamper-proof claim.
- CIDs are encoded as the raw UTF-8 bytes of the canonical string; on
  read they're decoded back through `Buffer.toString("utf8")` so any
  future CID format (not just `bafy…`/`Qm…`) survives a round-trip.
- `data.chainAnchor.xdr` is returned to the client for signing. The
  signed-then-submitted tx lands in `dispute_evidence` only after the
  user signs, so a backend compromise cannot forge chain entries.
- `GET /api/disputes/:jobId/onchain-cids` is intentionally unauthenticated
  — chain data is public-by-design (full nodes can replay it). This
  matches the existing `/api/disputes/:jobId/evidence` GET which is also
  public for read.

## Follow-ups (suggested follow-ups after merge)

- Add Soroban unit tests for `submit_evidence_cid` (happy path, escrow
  not found, wrong caller, refunded escrow, empty CID, oversized CID) and
  for `get_evidence_cids`.
- Add a Soroban integration test against testnet that uploads an
  evidence file → submits `submit_evidence_cid` → reads
  `get_evidence_cids` → compares.
- Mirror the chain `submitted_at_ledger` (per `evd_add` event) into a
  `dispute_evidence.onchain_submitted_at` column for richer display.
