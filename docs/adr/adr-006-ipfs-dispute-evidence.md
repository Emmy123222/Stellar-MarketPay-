# ADR-006: IPFS for Dispute Evidence Storage

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Frontend Team, DevOps Team

## Context

Stellar MarketPay includes a dispute resolution system where clients or freelancers can contest job outcomes. Disputes require evidence (screenshots, documents, chat logs, contracts) to be:

- Stored securely and permanently
- Tamper-proof and verifiable
- Accessible to dispute arbitrators
- Decentralized (not controlled by platform)
- Cost-effective for storage
- Immutable after submission

Traditional cloud storage (S3, Azure Blob) is centralized and controlled by the platform, creating trust issues. Evidence could theoretically be deleted or modified by administrators.

## Decision

We will use **IPFS (InterPlanetary File System)** via **Pinata** as the storage backend for dispute evidence, with the following architecture:

### Storage Flow

```
1. User uploads evidence file (PDF, image, document)
2. Frontend validates file type and size
3. File uploaded to IPFS via Pinata API
4. Pinata returns IPFS content hash (CID)
5. Frontend submits dispute with IPFS hash
6. Backend stores hash in database
7. Evidence accessible via IPFS gateway
8. Hash proves file integrity
```

### Architecture

```
Frontend (Upload)
   ↓
Pinata API (Pin to IPFS)
   ↓
IPFS Network (Distributed Storage)
   ↓
Backend DB (Store Hash)
   ↓
IPFS Gateway (Retrieve)
```

### Database Schema

```sql
CREATE TABLE disputes (
  id UUID PRIMARY KEY,
  job_id VARCHAR(255) NOT NULL,
  initiator_address VARCHAR(56) NOT NULL,
  reason TEXT NOT NULL,
  evidence_ipfs_hash VARCHAR(255), -- IPFS CID (e.g., QmXxx...)
  evidence_url TEXT,               -- Gateway URL
  evidence_filename VARCHAR(255),
  evidence_size_bytes BIGINT,
  status VARCHAR(50) DEFAULT 'open',
  resolution TEXT,
  resolved_by VARCHAR(56),
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX idx_disputes_job ON disputes(job_id);
CREATE INDEX idx_disputes_status ON disputes(status);
```

### Implementation

```typescript
// Upload to IPFS via Pinata
async function uploadToIPFS(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'pinata_api_key': process.env.NEXT_PUBLIC_PINATA_API_KEY!,
      'pinata_secret_api_key': process.env.PINATA_API_SECRET!,
    },
    body: formData,
  });
  
  const { IpfsHash } = await response.json();
  return IpfsHash; // e.g., QmXxx...
}

// Access via gateway
function getIPFSUrl(cid: string): string {
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}
```

## Rationale

### Why IPFS?

- **Content-Addressed**: Files identified by hash, not location
- **Immutable**: Hash proves file hasn't been modified
- **Decentralized**: No single point of failure or control
- **Permanent**: Files persist as long as someone pins them
- **Verifiable**: Anyone can verify hash matches content
- **Censorship-Resistant**: No central authority can delete files
- **Open Standard**: Not tied to proprietary platform

### Why Pinata?

- **Managed IPFS**: No need to run our own IPFS nodes
- **Reliable Pinning**: Ensures files remain available
- **Fast Uploads**: Optimized for performance
- **Free Tier**: 1GB storage + 10GB bandwidth/month
- **CDN Integration**: Fast global access
- **API-First**: Easy integration
- **Analytics**: Track usage and storage

### Why Not Alternatives?

#### AWS S3 / Azure Blob

- **Pros**: Fast, cheap, reliable
- **Cons**: Centralized, platform-controlled, can be deleted, not censorship-resistant

#### Database BLOB Storage

- **Pros**: Simple, no external dependency
- **Cons**: Expensive, slow, not scalable, centralized

#### Arweave

- **Pros**: Permanent storage (200+ years), pay-once
- **Cons**: More expensive upfront, less mature ecosystem, overkill for disputes

#### Traditional File Hosting

- **Pros**: Simple
- **Cons**: No immutability, can be deleted, centralized control

#### IPFS without Pinata (Self-Hosted)

- **Pros**: No third-party dependency, full control
- **Cons**: Operational overhead, must maintain nodes, complex

## Rejected Alternatives

This section records the alternatives considered alongside the decision above and
why they were rejected. It expands on the shorter "Why Not Alternatives?" notes in
[Rationale](#rationale).

### Centralised storage (AWS S3, Azure Blob, database BLOBs, plain file hosting)

- **Platform control breaks trustless disputes.** Evidence could be deleted,
  edited, or access-revoked by an administrator. Dispute resolution is only
  credible if neither party (nor the operator) can rewrite the record.
- **No content addressing.** Retrieval is by mutable key/path, so there is no
  cryptographic way for an arbitrator to prove the file is the one that was
  originally submitted. IPFS's CID gives that guarantee for free.
- **Vendor lock-in and egress cost.** Migrating tens of thousands of evidence
  objects between providers is expensive and risks availability gaps; S3 egress
  pricing also grows with dispute volume.
- **Database BLOBs specifically** bloat backups and the connection pool, stream
  poorly, and couple evidence lifetime to the application schema.

Rejected: centralised storage cannot provide the immutability and verifiability
that dispute evidence requires.

### Automatic fallback to alternative public gateways

Routing around a failed gateway by trying `ipfs.io`, `dweb.link`,
`cloudflare-ipfs.com`, etc. was considered and **rejected for now**:

- **No availability SLA.** Public gateways rate-limit aggressively and are not a
  production-grade dependency; the "fallback" can be flakier than the primary.
- **Privacy exposure.** Every gateway request reveals the CID — and, for
  dispute evidence, the CID alone can be sensitive — plus the requester's IP, to
  a third-party operator with no data-processing agreement.
- **Maintenance churn.** The public gateway landscape changes (e.g. gateways
  have been retired); keeping a hard-coded list current is ongoing work for a
  marginal benefit.
- **Limited efficacy.** Failover does not help when the failure is at the network
  level or when content was never pinned, which is the common real-world case.
- **Latency variance.** Trying gateways serially blows the streaming proxy's
  timeout budget, turning a fast failure into a slow one.

Rejected: a *deliberate, observable* failure with an operational runbook is
preferable to silent, best-effort degradation. Revisit if Pinata's availability
SLA becomes the dominant reliability risk.

### Self-hosted IPFS node / private gateway

Gives full control and removes the third-party dependency, but requires running
and monitoring nodes, storage, and upgrades — operational overhead the team cannot
staff today. Recorded as a future consideration rather than the present decision.

## Gateway Failure Behaviour

**Current fallback behaviour: none (by decision).** The system depends on a single
gateway and fails loudly when it is unavailable.

| Path | Behaviour when the gateway is down |
|------|-----------------------------------|
| Upload (`uploadFile`, `uploadMessage`) | Returns `503` with code `IPFS_UPLOAD_FAILED` (or `PINATA_NOT_CONFIGURED` when credentials are absent). |
| Evidence retrieval URL (`getGatewayUrl`) | Still returns the Pinata URL, but the link will not resolve until the gateway recovers. |
| Backend evidence proxy (`proxyIpfsFile` → `GET /api/disputes/:jobId/evidence/:id/proxy`) | The upstream request fails and the error surfaces to the client as a `5xx`; no alternative gateway is attempted. |

Two properties keep this safe:

1. **Evidence is never lost.** The CID is stored in `dispute_evidence.ipfs_cid`;
   the file itself lives on the IPFS network. A gateway outage affects *reachability*,
   not *existence*. The same CID can be served by any other gateway once the
   primary recovers.
2. **Failures are visible.** Because there is no silent retry against untrusted
   gateways, an outage raises errors and alerts instead of degrading quietly and
   corrupting the audit trail.

Operators responding to an outage should follow the
**[IPFS Gateway Failure runbook](../runbooks/ipfs-gateway-failure.md)** — it covers
confirmation, impact assessment, temporary manual retrieval through an alternative
gateway, restoration checks, and escalation.

## Consequences

### Positive

- ✅ **Tamper-Proof**: Content hash proves file integrity
- ✅ **Decentralized**: Not controlled by platform
- ✅ **Permanent**: Files persist indefinitely
- ✅ **Transparent**: Anyone can verify evidence
- ✅ **Cost-Effective**: Free tier sufficient for MVP
- ✅ **Trustless**: No need to trust platform with evidence
- ✅ **Censorship-Resistant**: Cannot be deleted by admins
- ✅ **Publicly Verifiable**: Anyone with hash can verify

### Negative

- ❌ **External Dependency**: Relies on Pinata availability
- ❌ **Upload Speed**: Slower than direct S3 upload
- ❌ **Storage Limits**: Free tier has 1GB limit
- ❌ **Bandwidth Costs**: High traffic may require paid plan
- ❌ **Immutability Constraint**: Cannot edit files after upload
- ❌ **Privacy Concerns**: Files are public (anyone with hash can access)
- ❌ **IPFS Propagation**: May take seconds to become available

## Implementation Details

### File Validation

```typescript
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function validateFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 50MB)');
  }
  
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('File type not allowed');
  }
}
```

### Metadata

```typescript
// Add metadata to pinned file
await pinata.metadata.update({
  ipfsHash: cid,
  name: file.name,
  keyvalues: {
    uploadedBy: userAddress,
    disputeId: dispute.id,
    uploadedAt: new Date().toISOString(),
    fileSize: file.size.toString(),
    fileType: file.type,
  },
});
```

### Gateway Selection

A single, explicit gateway is used today. Both the URL builder and the backend
streaming proxy resolve to the Pinata gateway
(`https://gateway.pinata.cloud/ipfs/<cid>`) — see
`backend/src/services/ipfsService.js` (`getGatewayUrl`, `proxyIpfsFile`). There is
no environment override and **no automatic failover** to a second gateway; see
[Gateway Failure Behaviour](#gateway-failure-behaviour) for the rationale and the
runbook.

### Privacy Considerations

**Problem**: IPFS files are public. Anyone with the CID can access evidence.

**Solutions**:

1. **Client-Side Encryption** (Recommended)
   ```typescript
   // Encrypt file before upload
   const encrypted = await encryptFile(file, disputeKey);
   const cid = await uploadToIPFS(encrypted);
   // Store decryption key in dispute record (access-controlled)
   ```

2. **Access Control List**
   ```sql
   CREATE TABLE dispute_evidence_access (
     dispute_id UUID NOT NULL,
     user_address VARCHAR(56) NOT NULL,
     granted_at TIMESTAMP DEFAULT NOW(),
     PRIMARY KEY (dispute_id, user_address)
   );
   ```

3. **Private IPFS Networks**
   - Use Pinata's submarine feature (paid)
   - Run private IPFS cluster

For MVP, we accept public access and recommend users not include sensitive personal information in evidence. Future versions will implement client-side encryption.

### Cost Management

**Pinata Free Tier**:
- Storage: 1GB
- Bandwidth: 10GB/month
- Requests: Unlimited

**Paid Plans** (if needed):
- Picnic: $20/month (100GB storage, 100GB bandwidth)
- Custom: Contact sales

**Cost Optimization**:
- Compress images before upload
- Use PDF compression for documents
- Implement file size warnings
- Monitor usage dashboard

### Backup Strategy

While IPFS is decentralized, we should maintain backups:

```typescript
// Periodically backup all dispute evidence CIDs
async function backupDisputeEvidence() {
  const disputes = await db.query(
    'SELECT evidence_ipfs_hash FROM disputes WHERE evidence_ipfs_hash IS NOT NULL'
  );
  
  const backupManifest = {
    timestamp: new Date().toISOString(),
    cids: disputes.rows.map(d => d.evidence_ipfs_hash),
  };
  
  // Store manifest on IPFS itself
  const manifestCid = await uploadJSONToIPFS(backupManifest);
  
  // Store manifest CID in safe location
  await db.query(
    'INSERT INTO backup_manifests (ipfs_hash, created_at) VALUES ($1, NOW())',
    [manifestCid]
  );
}
```

### Monitoring

```typescript
// Check if evidence is accessible
async function verifyEvidence(cid: string): Promise<boolean> {
  try {
    const response = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`, {
      method: 'HEAD',
      timeout: 10000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Cron job to verify all evidence
async function auditEvidenceAvailability() {
  const disputes = await db.query(
    'SELECT id, evidence_ipfs_hash FROM disputes WHERE status = "open"'
  );
  
  for (const dispute of disputes.rows) {
    const available = await verifyEvidence(dispute.evidence_ipfs_hash);
    if (!available) {
      await notifyAdmin(`Evidence unavailable: ${dispute.id}`);
    }
  }
}
```

## Future Considerations

### Encrypted Evidence

Implement client-side encryption before IPFS upload to protect sensitive evidence.

### Direct IPFS Node

For full decentralization, run our own IPFS nodes instead of relying on Pinata.

### Multiple Evidence Files

Allow multiple evidence files per dispute by storing array of CIDs.

### Evidence Verification

Implement on-chain evidence hash registry for additional verification layer.

### Arweave Migration

For critical disputes, mirror evidence to Arweave for permanent storage guarantee.

## Related ADRs

- ADR-005: NaCl Message Encryption (similar client-side encryption)
- ADR-003: Database Schema for Disputes

## Related Runbooks

- [IPFS Gateway Failure](../runbooks/ipfs-gateway-failure.md)

## References

- [IPFS Documentation](https://docs.ipfs.io/)
- [Pinata Documentation](https://docs.pinata.cloud/)
- [Content Addressing](https://docs.ipfs.io/concepts/content-addressing/)
- [IPFS Gateway Specification](https://specs.ipfs.tech/http-gateways/)
- [Pinata Pricing](https://www.pinata.cloud/pricing)
- [IPFS Best Practices](https://docs.ipfs.io/how-to/best-practices-for-nft-data/)
