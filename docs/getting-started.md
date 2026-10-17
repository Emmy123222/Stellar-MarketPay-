# Getting Started

Welcome to Stellar MarketPay 👋  
This guide will walk you through setting up the project locally and completing a full workflow; from funding your wallet to posting and completing a job.

---

## 1. Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **Git**
- A modern browser (Chrome recommended)

### Install Freighter Wallet

Freighter is required to interact with the Stellar blockchain.

1. Visit: https://freighter.app/
2. Install the browser extension
3. Create a new wallet or import an existing one
4. Safely store your secret key

### Switch to Testnet

1. Open Freighter
2. Go to **Settings**
3. Change network from **Public** → **Testnet**

> ⚠️ This project uses Stellar Testnet. Transactions will not work on Public network.

---

## 2. Running the App Locally

### Clone the Repository

```bash
git clone https://github.com/Emmy123222/Stellar-MarketPay-.git
cd Stellar-MarketPay-
```


### Setup Development Environment
If the project includes a setup script:
```bash
chmod +x setup-dev.sh
./setup-dev.sh
```

If not, install dependencies manually:
```bash
# Frontend
cd frontend
npm install

# Backend
cd ../backend
```

### Start the Application
Open two terminals:
```bash
# Terminal 1 - Backend
cd backend
npm run dev
```
```bash
# Terminal 2 - Frontend
cd frontend
npm run dev
```

Access the App
- Frontend: http://localhost:3000

- Backend API: http://localhost:3001

### Production Build & Bundle Analysis
To build the frontend for production or analyze bundle sizes:
```bash
cd frontend

# Production build
npm run build

# Build with bundle analyzer
npm run analyze
```

> **Cross-Platform / Windows Support**: All frontend build and development tasks are driven by cross-platform Node.js scripts that run uniformly across Linux, macOS, and Windows (PowerShell, Command Prompt, Git Bash, and WSL) without requiring platform-specific scripts.

## 3. Getting Testnet XLM
You need test tokens to use the app.

#### Fund Your Wallet Using Friendbot
1. Go to: https://friendbot.stellar.org/
2. Copy your Freighter wallet address
3. Paste it into the input field
4. Click "Get Testnet XLM"

#### Expected Result
- Your wallet will receive free test XLM
- Balance should appear in Freighter immediately

>If it doesn’t show, refresh your wallet or reconnect it in the app.


## 4. Post Your First Job
1. Open the app in your browser
2. Connect your Freighter wallet
3. Navigate to the Post Job page
Fill in the required fields:

- *Job Title* → Clear name of the task
- *Description* → What needs to be done
- *Budget (XLM)* → Payment amount
- *Deadline* → When the job should be completed
4. Click Submit
5. Approve the transaction in Freighter

✅ Your job is now live on the marketplace.

## 5. Apply for a Job
To simulate a freelancer, you will need a second wallet.

#### Create or Switch Wallet
1. Create/import another wallet in Freighter
2. Fund it again using Friendbot

#### Submit a Proposal
1. Browse available jobs
2. Click on a job listing
3. Click Apply or Submit Proposal
Fill in:
- Proposal Message → Why you are a good fit
- Bid Amount (if applicable)
4. Submit the proposal
5. Approve the transaction

✅ Your application is now submitted.

## 6. Release Escrow Payment
Once the job is completed:

1. Switch back to the job creator wallet
2. Open the job details page
3. Review the submitted work
4. Click Release Payment
5. Confirm the transaction in Freighter

💸 Funds will be released to the freelancer.

## Troubleshooting
#### Freighter Wallet Not Detected
- Ensure extension is installed
- Refresh your browser
- Check Freighter permissions

#### Wallet Balance is 0
- Use Friendbot: https://friendbot.stellar.org/
- Confirm wallet is on Testnet

#### Transactions Not Prompting
- Unlock Freighter wallet
- Disable popup blockers
- Refresh the page

#### App Not Loading
- Ensure backend is running on port 3001
- Ensure frontend is running on port 3000
- Check browser console for errors

#### Cannot Connect Wallet
- Make sure network is set to Testnet
- Disconnect and reconnect wallet
- Restart browser if needed

## Helpful Links
- Freighter Wallet: https://freighter.app/

- Stellar Friendbot: https://friendbot.stellar.org/

