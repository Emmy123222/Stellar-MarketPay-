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

Multiple gateways provide redundancy:

```typescript
const GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs',
  'https://ipfs.io/ipfs',
  'https://cloudflare-ipfs.com/ipfs',
  'https://dweb.link/ipfs',
];

// Try gateways in order until success
async function fetchFromIPFS(cid: string): Promise<Blob> {
  for (const gateway of GATEWAYS) {
    try {
      const response = await fetch(`${gateway}/${cid}`, {
        timeout: 5000,
      });
      if (response.ok) return response.blob();
    } catch (error) {
      console.warn(`Gateway ${gateway} failed:`, error);
    }
  }
  throw new Error('All IPFS gateways failed');
}
```

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

## References

- [IPFS Documentation](https://docs.ipfs.io/)
- [Pinata Documentation](https://docs.pinata.cloud/)
- [Content Addressing](https://docs.ipfs.io/concepts/content-addressing/)
- [IPFS Gateway Specification](https://specs.ipfs.tech/http-gateways/)
- [Pinata Pricing](https://www.pinata.cloud/pricing)
- [IPFS Best Practices](https://docs.ipfs.io/how-to/best-practices-for-nft-data/)
