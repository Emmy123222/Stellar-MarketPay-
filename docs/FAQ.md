# Frequently Asked Questions (FAQ)

## General Questions

### What is Stellar MarketPay?

Stellar MarketPay is a decentralized freelance marketplace powered by the Stellar blockchain and Soroban smart contracts. It connects clients with freelancers for project-based work, with payments secured in smart contract escrow until work is approved.

### How is it different from Upwork or Fiverr?

- **No middleman fees**: We don't take a cut of your earnings
- **Blockchain-based**: All transactions are transparent and on-chain
- **Instant payments**: Funds are released immediately when work is approved
- **Global access**: No geographic restrictions or payment delays
- **Open source**: The code is publicly available and auditable

### Is Stellar MarketPay safe?

Yes. Funds are locked in Soroban smart contracts, which are:

- Audited for security
- Deterministic (always execute the same way)
- Transparent (code is publicly available)
- Non-custodial (we never hold your funds)

However, like any blockchain platform, there are risks. Always verify contract addresses and use the official website.

### What blockchain does it use?

Stellar MarketPay uses the **Stellar blockchain** with **Soroban smart contracts**. Stellar is known for:

- Low transaction fees (typically < $0.01)
- Fast confirmation times (3-5 seconds)
- Energy efficiency
- Strong focus on financial inclusion

---

## Getting Started

### How do I sign up?

1. Install the [Freighter wallet](https://freighter.app) browser extension
2. Create a Stellar account in Freighter
3. Visit [stellar-marketpay.com](https://stellar-marketpay.com)
4. Click "Connect Wallet"
5. Sign the authentication message
6. Complete your profile

### Do I need to buy XLM to get started?

Yes, you need XLM (Stellar's native asset) to:

- Post jobs (funds locked in escrow)
- Pay transaction fees (typically < $0.01 per transaction)

You can get free XLM from the [Stellar Testnet Faucet](https://developers.stellar.org/docs/learn/fundamentals/testnet) for testing.

### What is Freighter?

Freighter is a browser wallet extension that securely manages your Stellar account. It:

- Stores your private keys locally (never shared)
- Signs transactions without exposing your keys
- Integrates with Stellar MarketPay
- Works on Chrome, Firefox, and Edge

[Download Freighter](https://freighter.app)

### How do I fund my account?

1. **Testnet (for development)**:
   - Use the [Stellar Testnet Faucet](https://developers.stellar.org/docs/learn/fundamentals/testnet)
   - Paste your public key and receive 10,000 XLM

2. **Mainnet (production)**:
   - Buy XLM from an exchange (Kraken, Coinbase, etc.)
   - Transfer to your Freighter wallet address

---

## For Clients

### How do I post a job?

1. Click "Post a Job" on the dashboard
2. Fill in job details:
   - Title and description
   - Budget in XLM
   - Skills required
   - Deadline
3. Review the escrow amount
4. Sign the transaction in Freighter
5. Job is live and freelancers can apply

### What happens to my funds when I post a job?

Your funds are locked in a Soroban smart contract escrow. They are:

- **Not held by us** (non-custodial)
- **Secure** (protected by cryptography)
- **Refundable** (returned if job expires or is cancelled)
- **Released only** when you approve the work

### How do I approve work and release payment?

1. Review the freelancer's work
2. Click "Approve & Release" on the job
3. Sign the transaction in Freighter
4. Funds are instantly transferred to the freelancer

### What if I'm not satisfied with the work?

1. Open a dispute on the job
2. Provide evidence (screenshots, messages, etc.)
3. Upload evidence to IPFS via Pinata
4. Admin team reviews and makes a decision
5. Funds are either released or refunded

### Can I get a refund?

Yes, in these scenarios:

- **Job expires**: Funds are automatically refunded after 30 days
- **Freelancer doesn't start**: You can cancel and get refunded
- **Dispute resolution**: Admin may refund if work is unsatisfactory

### How much does it cost?

- **Platform fee**: 0% (we don't take a cut)
- **Transaction fees**: < $0.01 per transaction (Stellar network fee)
- **No hidden fees**: What you see is what you pay

---

## For Freelancers

### How do I find jobs?

1. Go to the "Browse Jobs" page
2. Filter by:
   - Skills
   - Budget
   - Category
   - Deadline
3. Click on a job to view details
4. Click "Apply" to submit a proposal

### How do I submit a proposal?

1. Click "Apply" on a job
2. Write your proposal:
   - Explain your approach
   - Highlight relevant experience
   - Propose a timeline
3. Set your bid amount (can be less than job budget)
4. Submit

### When do I get paid?

1. Client approves your work
2. Client clicks "Release Payment"
3. Funds are instantly transferred to your wallet
4. You can withdraw or use immediately

### Can I withdraw my earnings?

Yes, you can:

- **Keep in wallet**: Use XLM for future transactions
- **Withdraw to bank**: Use our withdrawal service (fees apply)
- **Trade on exchange**: Sell XLM on Kraken, Coinbase, etc.

### What if the client doesn't approve my work?

1. You can message the client to discuss
2. If unresolved, the client can open a dispute
3. Admin team reviews both sides
4. Decision is made (release or refund)

### How do I build my reputation?

- Complete jobs successfully
- Get positive ratings from clients
- Build a portfolio of completed work
- Increase your freelancer tier (Newcomer → Expert → Top Talent)

---

## Transactions & Payments

### How do I view my transaction history?

1. Go to Dashboard
2. Click "Transaction History"
3. Filter by:
   - All transactions
   - Sent payments
   - Received payments
   - Escrow operations
4. Click "View" to see details on Stellar Expert

### What is a transaction hash?

A transaction hash (or tx hash) is a unique identifier for a blockchain transaction. It:

- Proves the transaction occurred
- Links to all transaction details
- Can be verified on Stellar Expert
- Is permanent and immutable

### How long do transactions take?

- **Confirmation**: 3-5 seconds on Stellar network
- **Finality**: Immediate (no reversals after confirmation)
- **Display**: May take 10-30 seconds to appear in UI

### What are transaction fees?

Stellar transaction fees are:

- **Fixed**: ~0.00001 XLM per operation
- **Typical**: < $0.01 per transaction
- **Paid by**: Transaction initiator
- **Used for**: Network security and spam prevention

### Can I cancel a transaction?

No, blockchain transactions are immutable once confirmed. However:

- **Before signing**: You can cancel in Freighter
- **After confirmation**: Transaction cannot be reversed
- **Disputes**: Open a dispute if transaction was unauthorized

---

## Disputes & Refunds

### How do I open a dispute?

1. Go to the job
2. Click "Open Dispute"
3. Select reason:
   - Work not completed
   - Work doesn't match description
   - Communication issues
   - Other
4. Upload evidence (screenshots, files, etc.)
5. Submit

### What evidence should I provide?

- Screenshots of messages
- Work samples or deliverables
- Timeline of events
- Any relevant documentation
- Links to IPFS-hosted files

### How long does dispute resolution take?

- **Initial review**: 24-48 hours
- **Investigation**: 3-7 days
- **Decision**: Final resolution within 7 days
- **Appeal**: 7 days to appeal decision

### What happens if I lose a dispute?

- Funds are released to the freelancer
- You can appeal the decision
- Future disputes may affect your account standing

### Can I get a refund after payment?

Refunds are only available through:

- **Dispute process**: If work doesn't meet requirements
- **Mutual agreement**: Both parties agree to refund
- **Admin decision**: In cases of fraud or abuse

---

## Technical Questions

### What is a smart contract?

A smart contract is self-executing code on the blockchain that:

- Automatically enforces agreements
- Cannot be modified or stopped
- Executes exactly as written
- Is transparent and auditable

Stellar MarketPay uses Soroban smart contracts to manage escrow.

### What is IPFS and Pinata?

- **IPFS**: InterPlanetary File System - a decentralized storage network
- **Pinata**: A service that makes IPFS easy to use
- **Use case**: Store dispute evidence, portfolio files, etc.

See [Pinata IPFS Setup Guide](./PINATA_IPFS_SETUP.md) for details.

### What is a wallet?

A wallet is software that:

- Stores your private keys (secret)
- Manages your public address (visible)
- Signs transactions
- Displays your balance

Freighter is the recommended wallet for Stellar MarketPay.

### What is a public key vs private key?

- **Public key**: Your account address (safe to share)
  - Example: `GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
  - Used to receive payments
  - Visible on blockchain

- **Private key**: Your secret password (never share!)
  - Used to sign transactions
  - Proves you own the account
  - If leaked, account can be compromised

### How do I keep my account secure?

1. **Never share your private key** with anyone
2. **Use Freighter**: Keeps keys secure locally
3. **Enable 2FA**: If available on the platform
4. **Verify URLs**: Always use official website
5. **Backup seed phrase**: Store safely offline
6. **Use strong passwords**: For Freighter and email

---

## Troubleshooting

### Freighter won't connect

1. Ensure Freighter extension is installed
2. Check if extension is enabled in browser
3. Refresh the page
4. Try a different browser
5. Reinstall Freighter if needed

### Transaction failed

Possible reasons:

- **Insufficient balance**: Not enough XLM for transaction + fees
- **Network issue**: Temporary Stellar network problem
- **Invalid data**: Malformed transaction
- **Timeout**: Transaction took too long to confirm

**Solution**: Try again or contact support

### I can't see my transaction

- **Delay**: May take 10-30 seconds to appear
- **Network**: Check Stellar Expert directly
- **Wrong account**: Verify you're logged into correct wallet
- **Testnet vs Mainnet**: Ensure you're on correct network

### My job isn't getting applications

- **Budget too low**: Increase budget to attract freelancers
- **Description unclear**: Improve job description
- **Skills too specific**: Broaden skill requirements
- **Visibility**: Ensure job is public, not private

### I can't withdraw my earnings

Possible reasons:

- **Insufficient balance**: Need minimum amount
- **Withdrawal service down**: Try again later
- **Account not verified**: Complete KYC if required
- **Geographic restrictions**: Some regions not supported

---

## Support & Community

### How do I contact support?

- **Email**: support@stellar-marketpay.com
- **Discord**: [Join our community](https://discord.gg/stellar-marketpay)
- **GitHub**: [Report issues](https://github.com/stellar-marketpay/issues)
- **Twitter**: [@StellarMarketPay](https://twitter.com/StellarMarketPay)

### Where can I learn more?

- [Stellar Documentation](https://developers.stellar.org)
- [Soroban Smart Contracts](https://soroban.stellar.org)
- [Freighter Wallet Guide](https://freighter.app/docs)
- [Our Blog](https://blog.stellar-marketpay.com)

### How can I contribute?

We're open source! You can:

- Report bugs on GitHub
- Submit pull requests
- Improve documentation
- Translate to other languages
- Share feedback

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

---

## Legal & Compliance

### Is Stellar MarketPay regulated?

Stellar MarketPay is a decentralized platform. We:

- Don't hold user funds (non-custodial)
- Don't provide financial advice
- Comply with applicable laws
- Recommend consulting legal counsel

### What about taxes?

Cryptocurrency transactions may be taxable in your jurisdiction. We:

- Provide transaction history for tax reporting
- Don't provide tax advice
- Recommend consulting a tax professional

### What is your privacy policy?

See [Privacy Policy](../PRIVACY.md) for details on:

- Data collection
- Data usage
- Data protection
- Your rights

### What about terms of service?

See [Terms of Service](../TERMS.md) for:

- User responsibilities
- Platform policies
- Dispute resolution
- Liability limitations

---

## Still have questions?

- Check our [Blog](https://blog.stellar-marketpay.com)
- Join our [Discord community](https://discord.gg/stellar-marketpay)
- Email support@stellar-marketpay.com
- Open an issue on [GitHub](https://github.com/stellar-marketpay/issues)
