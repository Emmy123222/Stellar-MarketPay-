# Pull Request: Job Referral & Affiliate Link System

## Overview
This pull request implements a comprehensive job referral and affiliate link system for the Stellar MarketPay platform. This feature incentivizes users to share job opportunities by rewarding them with reputation points when their referrals lead to successful hires and job completions.

## Key Features

### 1. Referral Link Generation
- Added a **"Refer a Freelancer"** button on job detail pages.
- Generates a unique referral URL encoding the Job ID and the referrer's wallet address.
- Seamless "copy-to-clipboard" functionality with user feedback.

### 2. Tracking & Persistence
- **Anonymous Tracking**: Referral clicks are tracked even if the visitor isn't logged in, using a combination of URL parameters and `localStorage` persistence.
- **Backend Logging**: Implemented a new `referrals` table and tracking endpoint that records Job ID, Referrer, and Visitor IP address.
- **Application Attribution**: Automatically links applications to their referrers upon submission.

### 3. Rewards & Reputation
- **Reputation Boost**: Referrers are credited with **5 reputation points** automatically upon successful job completion (escrow release).
- **Dynamic Stats**: Integrated referral counts and reputation bonuses into the profile data and the overall reputation score calculation.

## Technical Changes

### Backend
- **Schema**: Added `referrals` table and new columns to `profiles` and `applications`.
- **Services**: 
  - `jobService.js`: Added `trackReferral` logic.
  - `applicationService.js`: Updated to store `referred_by` metadata.
  - `escrow.js`: Implemented the reward trigger during escrow release.
- **Consistency**: Converted key services to CommonJS to ensure system-wide compatibility.

### Frontend
- **UI Components**: Updated `JobDetail` and `ApplicationForm` to handle referral logic.
- **Profile Page**: Added a new stats section showing "Referrals" and "Reputation Bonus".
- **API Client**: Expanded with `trackReferralClick` and updated application submission signatures.

## Verification
- [x] Referral links successfully store referrer data in `localStorage`.
- [x] Applications correctly record the `referred_by` address in the database.
- [x] Escrow release successfully triggers reputation point increases.
- [x] Profile page correctly aggregates and displays referral metrics.

#95 #66
