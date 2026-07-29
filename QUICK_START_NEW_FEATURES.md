# Quick Start: New Features Guide

**Last Updated**: May 28, 2026

This guide helps you quickly get started with the four new features implemented in Stellar MarketPay.

---

## 🚀 Feature 1: Transaction History Page

### What It Does

Displays all Stellar transactions for a user with filtering, pagination, and explorer links.

### Where to Find It

- **URL**: `/dashboard/transactions`
- **Navigation**: Dashboard → Transaction History

### How to Use

1. **Connect Wallet**
   - Click "Connect Wallet" if not already connected
   - Sign authentication message in Freighter

2. **View Transactions**
   - All transactions appear automatically
   - Sorted by newest first

3. **Filter Transactions**
   - Click filter tabs: "All", "Sent", "Received", "Escrow"
   - Filters update in real-time

4. **View Details**
   - Click "View" button on any transaction
   - Opens Stellar Expert in new tab
   - Shows full transaction details

5. **Load More**
   - Click "Load More" button at bottom
   - Fetches next 20 transactions

### Code Location

- **Frontend**: `frontend/lib/stellar.ts`
  - `fetchMarketPayTransactions()` - Fetch from Horizon API
  - `explorerUrl()` - Generate explorer links
  - `accountUrl()` - Generate account links
- **Page**: `frontend/pages/dashboard/transactions.tsx`

### Key Functions

```typescript
// Fetch transactions
const response = await fetchMarketPayTransactions(publicKey, limit, cursor);

// Generate explorer URL
const url = explorerUrl(txHash);

// Generate account URL
const url = accountUrl(publicKey);
```

### Testing

```bash
# Start frontend
cd frontend && npm run dev

# Navigate to http://localhost:3000/dashboard/transactions
# Connect wallet
# View your transactions
```

---

## 📚 Feature 2: Architecture Decision Records (ADRs)

### What They Are

Documentation of key architectural decisions with context, rationale, and consequences.

### Where to Find Them

- **Location**: `docs/ADR-*.md`
- **Files**:
  - `ADR-001-soroban-escrow-design.md` - Smart contract design
  - `ADR-002-horizon-api-indexing.md` - Transaction indexing
  - `ADR-003-database-schema-escrow.md` - Database schema

### How to Use

1. **Reference in Code**

   ```typescript
   // See ADR-001 for escrow contract design
   const escrow = await createEscrow(...);
   ```

2. **Link in Documentation**

   ```markdown
   See [ADR-001](./docs/ADR-001-soroban-escrow-design.md)
   ```

3. **Team Discussions**
   - Use as basis for architecture decisions
   - Reference when making similar choices
   - Update if decision changes

### ADR Format

Each ADR includes:

- **Status**: Accepted/Proposed/Deprecated
- **Context**: Problem statement
- **Decision**: What was decided
- **Rationale**: Why this decision
- **Consequences**: Positive and negative impacts
- **References**: External documentation

### Key Decisions

| ADR     | Decision                     | Rationale                                   |
| ------- | ---------------------------- | ------------------------------------------- |
| ADR-001 | Use Soroban for escrow       | Low fees, native to Stellar, type-safe      |
| ADR-002 | Use Horizon API for indexing | Official API, real-time, no custom indexing |
| ADR-003 | PostgreSQL for escrow state  | Fast queries, audit trail, ACID compliance  |

---

## ❓ Feature 3: FAQ Page

### What It Is

Comprehensive Q&A covering 50+ common questions about Stellar MarketPay.

### Where to Find It

- **Location**: `docs/FAQ.md`
- **Categories**: 10 main sections
- **Questions**: 50+ entries

### How to Use

1. **Find Answers**
   - Read through categories
   - Search for keywords
   - Follow links to related docs

2. **Link from Website**
   - Add to footer: "FAQ"
   - Add to help menu
   - Link from error messages

3. **Embed in Code**
   ```markdown
   See [FAQ](./docs/FAQ.md#how-do-i-post-a-job)
   ```

### FAQ Categories

1. **General Questions** - What is MarketPay, how is it different, is it safe?
2. **Getting Started** - Sign up, fund account, install Freighter
3. **For Clients** - Post jobs, manage funds, approve work
4. **For Freelancers** - Find jobs, submit proposals, get paid
5. **Transactions & Payments** - View history, understand fees
6. **Disputes & Refunds** - Open disputes, provide evidence
7. **Technical Questions** - Smart contracts, IPFS, wallets
8. **Troubleshooting** - Common issues and solutions
9. **Support & Community** - Contact support, contribute
10. **Legal & Compliance** - Regulations, taxes, privacy

### Key Questions

- "What is Stellar MarketPay?" → General overview
- "How do I post a job?" → Client guide
- "When do I get paid?" → Freelancer guide
- "Is it safe?" → Security explanation
- "What are transaction fees?" → Cost breakdown

---

## 📦 Feature 4: Pinata IPFS Setup Guide

### What It Is

Complete guide for setting up decentralized file storage for dispute evidence.

### Where to Find It

- **Location**: `docs/PINATA_IPFS_SETUP.md`
- **Sections**: 8 main steps + troubleshooting

### How to Implement

#### Step 1: Create Pinata Account

```
1. Go to https://pinata.cloud
2. Sign up with email
3. Verify email
4. Done!
```

#### Step 2: Generate API Keys

```
1. Go to https://pinata.cloud/keys
2. Click "New Key"
3. Enable "pinFileToIPFS" permission
4. Copy API Key and Secret
```

#### Step 3: Add to Environment

```env
# .env.local
NEXT_PUBLIC_PINATA_API_KEY=your_key
PINATA_API_SECRET=your_secret
```

#### Step 4: Install SDK

```bash
npm install pinata
```

#### Step 5: Create Upload Service

Copy code from guide to `frontend/lib/pinata.ts`:

```typescript
export async function uploadToIPFS(file: File): Promise<string>;
export function getIPFSUrl(hash: string): string;
```

#### Step 6: Create Upload Component

Copy code from guide to `frontend/components/DisputeEvidenceUpload.tsx`:

```typescript
export default function DisputeEvidenceUpload({ onUploadComplete });
```

#### Step 7: Integrate with Disputes

```typescript
// In dispute form
<DisputeEvidenceUpload onUploadComplete={handleUpload} />
```

#### Step 8: Test Upload

```
1. Go to dispute form
2. Select a file
3. Click upload
4. Verify IPFS hash returned
5. Access via https://gateway.pinata.cloud/ipfs/{hash}
```

### Key Functions

```typescript
// Upload file
const hash = await uploadToIPFS(file);

// Get URL
const url = getIPFSUrl(hash);

// Access file
window.open(url);
```

### File Size Limits

- **Free Tier**: 1GB storage, 10GB/month bandwidth
- **Paid Tier**: Higher limits available
- **Per File**: Max 50MB recommended

### Security

- ✅ Never commit API keys to Git
- ✅ Use environment variables
- ✅ Validate file types
- ✅ Implement rate limiting
- ✅ Monitor storage usage

---

## 📋 Implementation Checklist

### Frontend Tasks

- [x] Enhanced `stellar.ts` with transaction functions
- [ ] Add navigation link to transaction history
- [ ] Create `lib/pinata.ts` upload service
- [ ] Create `components/DisputeEvidenceUpload.tsx`
- [ ] Integrate upload component in dispute form
- [ ] Test transaction history page
- [ ] Test file upload to IPFS

### Backend Tasks

- [ ] Create disputes table migration
- [ ] Implement `/api/disputes` endpoints
- [ ] Add dispute resolution logic
- [ ] Implement timeout refund service
- [ ] Test dispute creation and resolution

### Documentation Tasks

- [x] Create ADR-001, ADR-002, ADR-003
- [x] Create FAQ page
- [x] Create Pinata setup guide
- [ ] Update README with new features
- [ ] Add FAQ link to website
- [ ] Create video tutorials

### Testing Tasks

- [ ] Test transaction history filtering
- [ ] Test transaction pagination
- [ ] Test file upload to IPFS
- [ ] Test dispute creation
- [ ] Test dispute resolution
- [ ] Test timeout refunds

---

## 🔗 Quick Links

### Documentation

- [Transaction History](./docs/FAQ.md#how-do-i-view-my-transaction-history)
- [ADR-001: Escrow Design](./docs/ADR-001-soroban-escrow-design.md)
- [ADR-002: Horizon API](./docs/ADR-002-horizon-api-indexing.md)
- [ADR-003: Database Schema](./docs/ADR-003-database-schema-escrow.md)
- [FAQ](./docs/FAQ.md)
- [Pinata Setup](./docs/PINATA_IPFS_SETUP.md)

### Code Files

- [stellar.ts](./frontend/lib/stellar.ts) - Transaction functions
- [transactions.tsx](./frontend/pages/dashboard/transactions.tsx) - Transaction page
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md) - Detailed overview

### External Resources

- [Stellar Docs](https://developers.stellar.org)
- [Horizon API](https://developers.stellar.org/api)
- [Pinata Docs](https://docs.pinata.cloud)
- [IPFS Docs](https://docs.ipfs.io)

---

## 🆘 Troubleshooting

### Transaction History Not Loading

**Problem**: "Failed to load transactions"

**Solutions**:

1. Check wallet is connected
2. Verify Horizon API is accessible
3. Check browser console for errors
4. Try refreshing page

### File Upload Fails

**Problem**: "Failed to upload file to IPFS"

**Solutions**:

1. Verify API keys are correct
2. Check file size < 50MB
3. Verify file type is supported
4. Check Pinata account is active

### API Key Issues

**Problem**: "Unauthorized" error

**Solutions**:

1. Regenerate API key in Pinata dashboard
2. Verify key has correct permissions
3. Check environment variables are set
4. Restart development server

---

## 📞 Support

- **GitHub Issues**: [stellar-marketpay/issues](https://github.com/stellar-marketpay/issues)
- **Discord**: [Stellar MarketPay Community](https://discord.gg/stellar-marketpay)
- **Email**: support@stellar-marketpay.com

---

## 📝 Next Steps

1. **Test Transaction History**
   - Navigate to `/dashboard/transactions`
   - Verify transactions load
   - Test filtering and pagination

2. **Review ADRs**
   - Read ADR-001, ADR-002, ADR-003
   - Understand architectural decisions
   - Reference in future decisions

3. **Share FAQ**
   - Add link to website footer
   - Share with support team
   - Translate to other languages

4. **Implement Pinata**
   - Create upload service
   - Create upload component
   - Integrate with disputes

---

**Happy coding! 🚀**
