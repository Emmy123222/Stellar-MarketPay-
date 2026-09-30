# Pinata IPFS Setup Guide for Dispute Evidence Storage

## Overview

This guide explains how to set up Pinata for storing dispute evidence and other files on IPFS (InterPlanetary File System) in Stellar MarketPay.

### What is IPFS?

IPFS is a decentralized file storage network where:

- Files are stored across multiple nodes
- Content is addressed by hash (immutable)
- No single point of failure
- Files persist as long as someone pins them

### What is Pinata?

Pinata is a service that makes IPFS easy to use:

- Web dashboard for file management
- API for programmatic uploads
- Automatic pinning (keeps files available)
- Bandwidth optimization
- Analytics and monitoring

### Why Pinata for Dispute Evidence?

- **Decentralized**: Evidence stored on IPFS, not our servers
- **Immutable**: Hash proves file hasn't been modified
- **Permanent**: Files persist indefinitely
- **Transparent**: Anyone can verify evidence
- **Cost-effective**: Free tier available for development

---

## Step 1: Create a Pinata Account

### 1.1 Sign Up

1. Go to [pinata.cloud](https://pinata.cloud)
2. Click "Sign Up"
3. Enter email and password
4. Verify email address
5. Complete account setup

### 1.2 Verify Email

- Check your email for verification link
- Click link to activate account
- You're ready to use Pinata!

### 1.3 Explore Dashboard

The Pinata dashboard shows:

- **Files**: All pinned files
- **API Keys**: For programmatic access
- **Usage**: Storage and bandwidth stats
- **Settings**: Account configuration

---

## Step 2: Generate API Keys

### 2.1 Create API Key

1. Go to [pinata.cloud/keys](https://pinata.cloud/keys)
2. Click "New Key"
3. Select permissions:
   - ✅ `pinFileToIPFS` (upload files)
   - ✅ `pinJSONToIPFS` (upload JSON)
   - ✅ `userPinnedDataTotal` (check usage)
4. Click "Generate"

### 2.2 Copy Keys

You'll see:

- **API Key**: Public identifier
- **API Secret**: Private key (keep secret!)
- **JWT Token**: For authentication

**⚠️ Important**: Never commit API keys to Git. Use environment variables.

### 2.3 Store Securely

Add to your `.env` file:

```env
# Pinata API Keys (for dispute evidence storage)
NEXT_PUBLIC_PINATA_API_KEY=your_api_key_here
PINATA_API_SECRET=your_api_secret_here
PINATA_JWT=your_jwt_token_here
```

Add to `.gitignore`:

```
.env
.env.local
.env.*.local
```

---

## Step 3: Install Pinata SDK

### 3.1 Install Package

```bash
npm install pinata
```

### 3.2 Verify Installation

```bash
npm list pinata
```

---

## Step 4: Implement File Upload

### 4.1 Create Upload Service

Create `frontend/lib/pinata.ts`:

```typescript
import { PinataSDK } from "pinata";

const pinata = new PinataSDK({
  pinataKey: process.env.NEXT_PUBLIC_PINATA_API_KEY,
  pinataSecret: process.env.PINATA_API_SECRET,
});

/**
 * Upload a file to IPFS via Pinata
 * @param file - File to upload
 * @param metadata - Optional metadata
 * @returns IPFS hash
 */
export async function uploadToIPFS(
  file: File,
  metadata?: Record<string, any>,
): Promise<string> {
  try {
    const upload = await pinata.upload.file(file);

    // Add metadata if provided
    if (metadata) {
      await pinata.metadata.update({
        ipfsHash: upload.IpfsHash,
        name: file.name,
        keyvalues: metadata,
      });
    }

    return upload.IpfsHash;
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    throw new Error("Failed to upload file to IPFS");
  }
}

/**
 * Upload JSON data to IPFS
 * @param data - JSON data to upload
 * @param name - Optional name for the file
 * @returns IPFS hash
 */
export async function uploadJSONToIPFS(
  data: Record<string, any>,
  name?: string,
): Promise<string> {
  try {
    const upload = await pinata.upload.json(data);
    return upload.IpfsHash;
  } catch (error) {
    console.error("Error uploading JSON to IPFS:", error);
    throw new Error("Failed to upload JSON to IPFS");
  }
}

/**
 * Get IPFS gateway URL for a hash
 * @param hash - IPFS hash
 * @returns Full URL to access file
 */
export function getIPFSUrl(hash: string): string {
  return `https://gateway.pinata.cloud/ipfs/${hash}`;
}

/**
 * Get Pinata gateway URL (alternative)
 * @param hash - IPFS hash
 * @returns Full URL to access file
 */
export function getPinataGatewayUrl(hash: string): string {
  return `https://gateway.pinata.cloud/ipfs/${hash}`;
}

/**
 * Get IPFS.io gateway URL (public gateway)
 * @param hash - IPFS hash
 * @returns Full URL to access file
 */
export function getPublicIPFSUrl(hash: string): string {
  return `https://ipfs.io/ipfs/${hash}`;
}
```

### 4.2 Create Upload Component

Create `frontend/components/DisputeEvidenceUpload.tsx`:

```typescript
import { useState } from "react";
import { uploadToIPFS, getIPFSUrl } from "@/lib/pinata";
import { useToast } from "@/components/Toast";

interface DisputeEvidenceUploadProps {
  onUploadComplete: (ipfsHash: string, url: string) => void;
}

export default function DisputeEvidenceUpload({
  onUploadComplete,
}: DisputeEvidenceUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { showToast } = useToast();

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      showToast("File too large. Maximum size is 50MB.", "error");
      return;
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedTypes.includes(file.type)) {
      showToast("File type not supported.", "error");
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const ipfsHash = await uploadToIPFS(file, {
        fileName: file.name,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
      });

      clearInterval(progressInterval);
      setProgress(100);

      const url = getIPFSUrl(ipfsHash);
      showToast("File uploaded successfully!", "success");
      onUploadComplete(ipfsHash, url);

      // Reset
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 1000);
    } catch (error) {
      console.error("Upload error:", error);
      showToast("Failed to upload file. Please try again.", "error");
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="border-2 border-dashed border-amber-600/30 rounded-lg p-6 text-center">
      <input
        type="file"
        id="evidence-upload"
        onChange={handleFileSelect}
        disabled={uploading}
        className="hidden"
        accept=".jpg,.jpeg,.png,.gif,.pdf,.txt,.doc,.docx"
      />

      <label
        htmlFor="evidence-upload"
        className={`cursor-pointer block ${uploading ? "opacity-50" : ""}`}
      >
        <svg
          className="w-12 h-12 mx-auto mb-3 text-amber-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 16v-4m0 0V8m0 4h4m-4 0H8M4 20h16a2 2 0 002-2V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>

        <p className="text-amber-100 font-medium mb-1">
          {uploading ? "Uploading..." : "Click to upload evidence"}
        </p>
        <p className="text-amber-800 text-sm">
          or drag and drop (max 50MB)
        </p>
      </label>

      {uploading && (
        <div className="mt-4">
          <div className="w-full bg-amber-900/20 rounded-full h-2">
            <div
              className="bg-amber-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-amber-700 text-xs mt-2">{progress}%</p>
        </div>
      )}

      <p className="text-amber-800 text-xs mt-4">
        Supported: JPG, PNG, GIF, PDF, TXT, DOC, DOCX
      </p>
    </div>
  );
}
```

### 4.3 Use in Dispute Form

```typescript
import DisputeEvidenceUpload from "@/components/DisputeEvidenceUpload";

export default function OpenDisputeForm() {
  const [evidenceIPFSHash, setEvidenceIPFSHash] = useState<string>("");

  const handleEvidenceUpload = (hash: string, url: string) => {
    setEvidenceIPFSHash(hash);
    console.log("Evidence uploaded to IPFS:", hash);
    console.log("Access at:", url);
  };

  return (
    <form>
      <div className="mb-6">
        <label className="block text-amber-100 font-medium mb-2">
          Upload Evidence
        </label>
        <DisputeEvidenceUpload onUploadComplete={handleEvidenceUpload} />
        {evidenceIPFSHash && (
          <p className="text-green-400 text-sm mt-2">
            ✓ Evidence uploaded: {evidenceIPFSHash.slice(0, 10)}...
          </p>
        )}
      </div>

      {/* Rest of form */}
    </form>
  );
}
```

---

## Step 5: Backend Integration

### 5.1 Store IPFS Hash in Database

Update `backend/src/db/migrations/V3__disputes.up.sql`:

```sql
CREATE TABLE disputes (
  id UUID PRIMARY KEY,
  job_id VARCHAR(255) NOT NULL,
  initiator_address VARCHAR(56) NOT NULL,
  reason TEXT,
  evidence_ipfs_hash VARCHAR(255),
  evidence_url TEXT,
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

### 5.2 Create Dispute Endpoint

Create `backend/src/routes/disputes.js`:

```javascript
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");

/**
 * POST /api/disputes
 * Create a new dispute with IPFS evidence
 */
router.post("/", async (req, res, next) => {
  try {
    const { jobId, reason, evidenceIPFSHash } = req.body;
    const initiatorAddress = req.user.publicKey;

    if (!jobId || !reason || !evidenceIPFSHash) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO disputes (job_id, initiator_address, reason, evidence_ipfs_hash, evidence_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        jobId,
        initiatorAddress,
        reason,
        evidenceIPFSHash,
        `https://gateway.pinata.cloud/ipfs/${evidenceIPFSHash}`,
      ],
    );

    res.json({
      success: true,
      data: rows[0],
      message: "Dispute created successfully",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/disputes/:jobId
 * Get dispute details
 */
router.get("/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM disputes WHERE job_id = $1`,
      [jobId],
    );

    res.json({
      success: true,
      data: rows[0] || null,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
```

---

## Step 6: Access Evidence Files

### 6.1 View Evidence in Dispute

```typescript
interface DisputeDetail {
  id: string;
  jobId: string;
  reason: string;
  evidenceIPFSHash: string;
  evidenceUrl: string;
  status: string;
}

export function DisputeDetail({ dispute }: { dispute: DisputeDetail }) {
  return (
    <div className="card">
      <h2 className="text-xl font-bold text-amber-100 mb-4">Dispute Details</h2>

      <div className="mb-6">
        <h3 className="text-amber-100 font-medium mb-2">Reason</h3>
        <p className="text-amber-800">{dispute.reason}</p>
      </div>

      {dispute.evidenceUrl && (
        <div className="mb-6">
          <h3 className="text-amber-100 font-medium mb-2">Evidence</h3>
          <a
            href={dispute.evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            View Evidence on IPFS
          </a>
          <p className="text-amber-700 text-xs mt-2 font-mono">
            Hash: {dispute.evidenceIPFSHash}
          </p>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-amber-100 font-medium mb-2">Status</h3>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          dispute.status === 'open' ? 'bg-blue-500/10 text-blue-400' :
          dispute.status === 'resolved' ? 'bg-green-500/10 text-green-400' :
          'bg-gray-500/10 text-gray-400'
        }`}>
          {dispute.status}
        </span>
      </div>
    </div>
  );
}
```

---

## Step 7: Testing

### 7.1 Test Upload

```bash
# Start development server
npm run dev

# Go to dispute form
# Select a file
# Click upload
# Verify IPFS hash is returned
```

### 7.2 Verify on Pinata Dashboard

1. Go to [pinata.cloud/files](https://pinata.cloud/files)
2. You should see your uploaded file
3. Click to view details
4. Copy IPFS hash

### 7.3 Access via Gateway

```
https://gateway.pinata.cloud/ipfs/{IPFS_HASH}
https://ipfs.io/ipfs/{IPFS_HASH}
```

---

## Step 8: Production Deployment

### 8.1 Environment Variables

Set in production:

```env
NEXT_PUBLIC_PINATA_API_KEY=prod_key
PINATA_API_SECRET=prod_secret
PINATA_JWT=prod_jwt
```

### 8.2 Rate Limiting

Pinata free tier has limits:

- **Storage**: 1GB
- **Bandwidth**: 10GB/month
- **Requests**: 100 per minute

For production, consider:

- Upgrading to paid plan
- Implementing request queuing
- Caching frequently accessed files

### 8.3 Monitoring

Monitor in Pinata dashboard:

- Storage usage
- Bandwidth usage
- Failed uploads
- File retention

---

## Troubleshooting

### Upload Fails

**Problem**: "Failed to upload file to IPFS"

**Solutions**:

1. Check API keys are correct
2. Verify file size < 50MB
3. Check network connection
4. Verify Pinata account is active

### File Not Accessible

**Problem**: "404 Not Found" when accessing IPFS URL

**Solutions**:

1. Verify IPFS hash is correct
2. Wait 30 seconds for propagation
3. Try different gateway:
   - `gateway.pinata.cloud`
   - `ipfs.io`
   - `dweb.link`
4. Check file is pinned in Pinata dashboard

### API Key Issues

**Problem**: "Unauthorized" or "Invalid API key"

**Solutions**:

1. Regenerate API key in Pinata dashboard
2. Verify key has correct permissions
3. Check environment variables are set
4. Restart development server

### Rate Limiting

**Problem**: "Too many requests"

**Solutions**:

1. Implement request queuing
2. Add delay between uploads
3. Upgrade Pinata plan
4. Cache results

---

## Best Practices

### Security

- ✅ Never commit API keys to Git
- ✅ Use environment variables
- ✅ Rotate keys regularly
- ✅ Use JWT tokens for API calls
- ✅ Validate file types before upload

### Performance

- ✅ Compress images before upload
- ✅ Implement progress indicators
- ✅ Cache IPFS URLs
- ✅ Use CDN for gateway access
- ✅ Batch uploads when possible

### Reliability

- ✅ Implement retry logic
- ✅ Handle upload failures gracefully
- ✅ Monitor storage usage
- ✅ Backup important files
- ✅ Test regularly

---

## Additional Resources

- [Pinata Documentation](https://docs.pinata.cloud)
- [IPFS Documentation](https://docs.ipfs.io)
- [Pinata API Reference](https://docs.pinata.cloud/api-reference)
- [IPFS Gateway Guide](https://docs.ipfs.io/how-to/address-ipfs-on-web/)
- [Pinata Pricing](https://www.pinata.cloud/pricing)

---

## Support

For issues or questions:

- [Pinata Support](https://support.pinata.cloud)
- [IPFS Community](https://discuss.ipfs.io)
- [GitHub Issues](https://github.com/stellar-marketpay/issues)
