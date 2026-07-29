# Environment Variables

This page is the single reference for runtime configuration in Stellar MarketPay.

## Backend

| Variable | Required | Default | Description | Example |
|---|---:|---|---|---|
| `DATABASE_URL` | Yes | None | PostgreSQL connection string used by the API and migrations. Validation: must be a non-empty URL. | `postgresql://user:pass@localhost:5432/marketpay` |
| `JWT_SECRET` | Yes | None | Signing key for auth tokens. Validation: must be long, random, and stable across restarts. | `4c9d0f7d6f4f4c0f8d1b3b...` |
| `STELLAR_NETWORK` | Yes | `testnet` | Network selector for backend auth and contract behavior. Validation: `testnet` or `mainnet`. | `testnet` |
| `HORIZON_URL` | No | `https://horizon-testnet.stellar.org` | Horizon endpoint used by the indexer and API helpers. | `https://horizon-testnet.stellar.org` |
| `CONTRACT_ID` | Yes | None | Soroban escrow contract ID used by the backend indexer. Validation: must be a deployed contract address. | `C...` |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000` | Comma-separated CORS allowlist. Validation: each origin must be a valid URL origin. | `http://localhost:3000,https://app.example.com` |
| `PORT` | No | `4000` | HTTP port for the Express API. | `4000` |
| `ADMIN_WALLET_ADDRESSES` | No | Empty | Comma-separated Stellar addresses with admin privileges. | `GABC...,GDEF...` |
| `SERVER_PRIVATE_KEY` | No | Generated per boot | Stellar keypair used to build challenge transactions. Validation: should be set in production so challenges are stable. | `S...` |
| `SMTP_HOST` | No | Empty | SMTP host used for email notifications. | `smtp.mailgun.org` |
| `SMTP_PORT` | No | `587` | SMTP port. | `587` |
| `SMTP_USER` | No | Empty | SMTP username. | `postmaster@example.com` |
| `SMTP_PASS` | No | Empty | SMTP password. | `secret` |
| `SMTP_FROM` | No | `SMTP_USER` | Sender address for outbound mail. | `noreply@example.com` |
| `PINATA_API_KEY` | No | Empty | Pinata API key for IPFS uploads. | `pinata-key` |
| `PINATA_SECRET_KEY` | No | Empty | Pinata secret key for IPFS uploads. | `pinata-secret` |
| `PINATA_API_URL` | No | `https://api.pinata.cloud` | Override for the Pinata API base URL. | `https://api.pinata.cloud` |
| `ESCROW_CONTRACT_ID` | No | Empty | Legacy alias for `CONTRACT_ID`; kept for backward compatibility. | `C...` |

## Frontend

| Variable | Required | Default | Description | Example |
|---|---:|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | `http://localhost:4000` | Base URL for the backend API. Validation: must be a valid URL origin. | `https://api.example.com` |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Yes | `testnet` | Network label used by the browser client and wallet flows. Validation: `testnet` or `mainnet`. | `testnet` |
| `NEXT_PUBLIC_HORIZON_URL` | No | `https://horizon-testnet.stellar.org` | Horizon endpoint exposed to the browser client. | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | No | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint used when building transactions. | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_CONTRACT_ID` | Yes unless mock mode is enabled | Empty | Soroban escrow contract ID used by the browser client. Validation: required when `NEXT_PUBLIC_USE_CONTRACT_MOCK` is not `true`. | `C...` |
| `NEXT_PUBLIC_USE_CONTRACT_MOCK` | No | `false` | Enables offline mock contract behavior for local development. | `true` |

## Validation Rules

- Backend startup fails fast when `DATABASE_URL`, `JWT_SECRET`, or `CONTRACT_ID` are missing.
- Frontend contract calls fail fast when `NEXT_PUBLIC_CONTRACT_ID` is missing and mock mode is disabled.
- The contract timeout now uses Unix timestamps for enforcement, but the legacy ledger-based field remains for compatibility with older escrows.

