# Runbook: IPFS Gateway Failure

**Severity:** SEV-2 (dispute evidence temporarily unreachable)
**Owner:** Backend on-call
**Related:** [ADR-006 — IPFS for Dispute Evidence Storage](../adr/adr-006-ipfs-dispute-evidence.md) · [Pinata IPFS Setup](../ipfs-setup.md)

---

## Summary

Stellar MarketPay stores dispute evidence on IPFS via **Pinata** and serves it
through a single gateway (`https://gateway.pinata.cloud/ipfs/<cid>`). There is
**no automatic gateway failover** — a gateway outage makes evidence temporarily
unreachable and surfaces as errors rather than silent degradation. This runbook
describes how to confirm the outage, assess impact, provide a temporary manual
retrieval path, and verify recovery.

Evidence is content-addressed, so a gateway outage never destroys data: the CID
stored in `dispute_evidence.ipfs_cid` still resolves on any working gateway.

---

## Symptoms

- Evidence uploads return `503` with `IPFS_UPLOAD_FAILED` (or
  `PINATA_NOT_CONFIGURED` if credentials are missing).
- `GET /api/disputes/:jobId/evidence/:id/proxy` fails with a `5xx`.
- Dispute evidence links in the UI do not load.
- Elevated `5xx` rate on dispute routes; gateway requests time out after the
  30-second client timeout.

## Detection

1. Confirm the API error shape:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' \
     http://localhost:4000/health
   ```
2. Attempt a direct fetch of a known CID through the gateway:
   ```bash
   CID=<cid-from-dispute_evidence.ipfs_cid>
   curl -sS -I --max-time 15 "https://gateway.pinata.cloud/ipfs/${CID}"
   ```
   A `502`/`504`/timeout here confirms the gateway (not the app) is the problem.
3. Check [Pinata status](https://status.pinata.cloud/) and the
   [Pinata dashboard](https://app.pinata.cloud/) for account/usage issues.

---

## Impact assessment

| Area | Impact |
| ---- | ------ |
| New dispute evidence uploads | Blocked — users see a "temporarily unavailable" error. |
| Existing evidence retrieval | Unreachable through the app while the gateway is down. |
| Data integrity | **None.** CIDs are stored in Postgres; files remain on IPFS. |
| Escrow / payments | **None.** Unrelated to the gateway. |

Record the outage window — arbitrators may need to know which evidence was
inaccessible during a review.

---

## Immediate mitigation

1. **Communicate.** Post a status note so users know evidence is temporarily
   unavailable and that no submission is lost once the gateway recovers.
2. **Temporary manual retrieval (urgent disputes only).** Fetch the CID through a
   public gateway and hand the file to the arbitrator out-of-band. Do **not**
   change application code or configuration during an incident:
   ```bash
   CID=<cid-from-dispute_evidence.ipfs_cid>
   curl -sSL --max-time 60 "https://ipfs.io/ipfs/${CID}" -o /tmp/evidence.bin
   curl -sSL --max-time 60 "https://dweb.link/ipfs/${CID}" -o /tmp/evidence-alt.bin
   ```
   > Manual gateways are for incident response only. Using them in application
   > code was explicitly rejected — see ADR-006, "Rejected Alternatives".
3. **Retry uploads later.** Uploads are not queued; ask users to resubmit once the
   gateway is healthy. Confirm credentials are still set if uploads fail while the
   gateway itself is up:
   ```bash
   # backend/.env
   PINATA_API_KEY=...
   PINATA_SECRET_KEY=...
   ```
   See [Environment Variables](../environment-variables.md) for the full list.

---

## Verification and recovery

1. Re-run the direct fetch from [Detection](#detection) until it returns `200`.
2. Verify the proxy endpoint streams content again:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' \
     "http://localhost:4000/api/disputes/<jobId>/evidence/<id>/proxy?token=<signed-token>"
   ```
3. Upload a small test file and confirm it returns a CID.
4. Confirm the `5xx` rate on dispute routes has returned to baseline.
5. Close the status note and record the incident.

If the gateway is healthy but the app still fails, check Pinata credentials and
the API key's pinning permissions before escalating.

---

## Escalation

- **If the outage exceeds 2 hours:** escalate to the backend maintainers and
  consider the self-hosted/private-gateway option tracked as a future
  consideration in ADR-006.
- **If credentials are suspected compromised:** rotate the Pinata keys, update
  `backend/.env`, and restart the backend.
- **If evidence integrity is in question:** verify the served bytes hash to the
  expected CID before trusting the file.

## Post-incident

- Record duration, affected disputes, and the mitigation used.
- Revisit the "no fallback" decision in
  [ADR-006](../adr/adr-006-ipfs-dispute-evidence.md) if the outage crossed the
  escalation threshold — the decision is deliberately reversible.

---

## Related documentation

- [ADR-006 — IPFS for Dispute Evidence Storage](../adr/adr-006-ipfs-dispute-evidence.md)
- [Pinata IPFS Setup](../ipfs-setup.md)
- [Environment Variables](../environment-variables.md)
- [Dispute Resolution](../dispute-resolution.md)
