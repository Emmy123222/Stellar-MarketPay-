# 🎬 Video Walkthrough Script — Stellar MarketPay

> **Target duration:** ~3 minutes  
> **Topic:** Happy-path user flow: Post a job → receive bids → accept a bid → release escrow  
> **Recording tool:** Loom (recommended) or OBS Studio  
> **Resolution:** 1920×1080  
> **Accessibility:** Captions/subtitles provided below for each scene

---

## 🎯 Scene Breakdown

| Scene | Time | Description |
|-------|------|-------------|
| 1 | 0:00–0:25 | Intro & wallet connect |
| 2 | 0:25–1:20 | Post a job (multi-step form) |
| 3 | 1:20–1:50 | Browse jobs as a freelancer |
| 4 | 1:50–2:15 | Apply / submit proposal |
| 5 | 2:15–2:35 | Client reviews & accepts bid |
| 6 | 2:35–2:55 | Escrow release (the money shot) |
| 7 | 2:55–3:00 | Outro & CTA |

---

## 🎥 Scene-by-Scene Guide

### Scene 1 — Intro & Wallet Connect (0:00–0:25)

**What to show:**
1. Open the browser to `http://localhost:3000` — the Stellar MarketPay landing page
2. Briefly pan over the hero section, stats bar, and "How it works" cards
3. Click **"Get Started Free"** → the Freighter wallet connect modal appears
4. Connect your Freighter wallet (Testnet)
5. Show the dashboard with XLM balance visible

**Caption (.srt format for this scene):**
```
1
00:00:00,000 --> 00:00:05,000
Welcome to Stellar MarketPay — a decentralized freelance marketplace built on Stellar.

2
00:00:05,000 --> 00:00:12,000
Clients post jobs. Freelancers apply. Payments are secured in Soroban smart contract escrow.

3
00:00:12,000 --> 00:00:18,000
Let's walk through the full happy path — from posting a job to releasing payment.

4
00:00:18,000 --> 00:00:25,000
First, connect your Freighter wallet. We're using Stellar Testnet so everything is free to try.
```

---

### Scene 2 — Post a Job (0:25–1:20)

**What to show:**
1. Click **"+ Post a Job"** from the dashboard
2. Step 1 — **Basic Info**: Fill in:
   - Title: `Build a Soroban Smart Contract Dashboard`
   - Description: `I need a Next.js dashboard that displays Soroban contract data...`
   - Category: `Frontend Development`
3. Click **Next**
4. Step 2 — **Budget & Escrow**: Set budget to `100 XLM`, keep single milestone
5. Click **Next**
6. Step 3 — **Requirements**: Add skills like `React, TypeScript, Soroban`
7. Click **Next**
8. Step 4 — **Review & Publish**: Show the summary, then click **Publish Job**
9. Show the Freighter wallet prompt → approve the transaction
10. Show the success state: "Job Posted!" with transaction hash

**Caption:**
```
5
00:00:25,000 --> 00:00:35,000
Head to the dashboard and click "Post a Job." You'll go through a 4-step form.

6
00:00:35,000 --> 00:00:50,000
Step 1: Enter the job title, a detailed description, and pick a category.

7
00:00:50,000 --> 00:01:05,000
Step 2: Set your budget in XLM. This amount will be locked in a Soroban escrow contract.

8
00:01:05,000 --> 00:01:20,000
Step 3: Add required skills and a deadline. Step 4: Review everything and publish. Approve the transaction in Freighter — your XLM is now locked on-chain.
```

---

### Scene 3 — Browse Jobs as Freelancer (1:20–1:50)

**What to show:**
1. Switch to a **second Freighter wallet** (or open an incognito window)
2. Navigate to the **Jobs** page (`/jobs`)
3. Show the job listings — find the job you just posted
4. Click on the job to view details
5. Show the job detail page: budget, description, skills, application count

**Caption:**
```
9
00:01:20,000 --> 00:01:35,000
Now let's switch to the freelancer's perspective. Using a second wallet, browse the Jobs page.

10
00:01:35,000 --> 00:01:50,000
Find the job that was just posted. You can see the budget, required skills, and full description.
```

---

### Scene 4 — Apply / Submit Proposal (1:50–2:15)

**What to show:**
1. On the job detail page, click **"Apply for this Job"**
2. Fill in the application form:
   - Proposal message: `I have 5 years of experience building Stellar dApps...`
   - Bid amount: `95 XLM`
3. Submit the application
4. Show the confirmation: "Application submitted"

**Caption:**
```
11
00:01:50,000 --> 00:02:00,000
Click "Apply for this Job." Write a compelling proposal and set your bid amount.

12
00:02:00,000 --> 00:02:15,000
Submit your application. The client will be notified and can review your proposal alongside others.
```

---

### Scene 5 — Client Reviews & Accepts Bid (2:15–2:35)

**What to show:**
1. Switch back to the **first wallet** (the client)
2. Navigate to the job detail page (or refresh)
3. Scroll to the **Applications** section — the new application is visible
4. Click **"Accept Proposal"** on the freelancer's application
5. Show the updated job status — now "In Progress"

**Caption:**
```
13
00:02:15,000 --> 00:02:25,000
Back as the client, refresh the job page. The new application appears in the Applications list.

14
00:02:25,000 --> 00:02:35,000
Review the proposal and click "Accept Proposal." The job status changes to "In Progress" and work begins.
```

---

### Scene 6 — Escrow Release (2:35–2:55)

**🎯 This is the key moment for the GIF preview**

**What to show:**
1. As the client, scroll to the **Escrow** section on the job page
2. Click **"Release Escrow"**
3. Show the Freighter wallet prompt → approve the transaction
4. Show the success message: "Escrow released successfully"
5. Optionally show the freelancer's wallet balance increasing

**Caption:**
```
15
00:02:35,000 --> 00:02:45,000
Once the work is complete, the client clicks "Release Escrow" to pay the freelancer.

16
00:02:45,000 --> 00:02:55,000
One click, one transaction — funds move instantly from the Soroban smart contract to the freelancer's wallet. No middlemen, no delays.
```

---

### Scene 7 — Outro & CTA (2:55–3:00)

**What to show:**
1. Fade to the Stellar MarketPay logo / landing page
2. Show the GitHub URL and call-to-action

**Caption:**
```
17
00:02:55,000 --> 00:03:00,000
Stellar MarketPay is open source. Try it yourself at the link below. Star us on GitHub!
```

---

## 📝 Full .srt Caption File

Save the following as `docs/demo-walkthrough-captions.srt` for use with your video:

```srt
1
00:00:00,000 --> 00:00:05,000
Welcome to Stellar MarketPay — a decentralized freelance marketplace built on Stellar.

2
00:00:05,000 --> 00:00:12,000
Clients post jobs. Freelancers apply. Payments are secured in Soroban smart contract escrow.

3
00:00:12,000 --> 00:00:18,000
Let's walk through the full happy path — from posting a job to releasing payment.

4
00:00:18,000 --> 00:00:25,000
First, connect your Freighter wallet. We're using Stellar Testnet so everything is free to try.

5
00:00:25,000 --> 00:00:35,000
Head to the dashboard and click "Post a Job." You'll go through a 4-step form.

6
00:00:35,000 --> 00:00:50,000
Step 1: Enter the job title, a detailed description, and pick a category.

7
00:00:50,000 --> 00:01:05,000
Step 2: Set your budget in XLM. This amount will be locked in a Soroban escrow contract.

8
00:01:05,000 --> 00:01:20,000
Step 3: Add required skills and a deadline. Step 4: Review everything and publish. Approve the transaction in Freighter — your XLM is now locked on-chain.

9
00:01:20,000 --> 00:01:35,000
Now let's switch to the freelancer's perspective. Using a second wallet, browse the Jobs page.

10
00:01:35,000 --> 00:01:50,000
Find the job that was just posted. You can see the budget, required skills, and full description.

11
00:01:50,000 --> 00:02:00,000
Click "Apply for this Job." Write a compelling proposal and set your bid amount.

12
00:02:00,000 --> 00:02:15,000
Submit your application. The client will be notified and can review your proposal alongside others.

13
00:02:15,000 --> 00:02:25,000
Back as the client, refresh the job page. The new application appears in the Applications list.

14
00:02:25,000 --> 00:02:35,000
Review the proposal and click "Accept Proposal." The job status changes to "In Progress" and work begins.

15
00:02:35,000 --> 00:02:45,000
Once the work is complete, the client clicks "Release Escrow" to pay the freelancer.

16
00:02:45,000 --> 00:02:55,000
One click, one transaction — funds move instantly from the Soroban smart contract to the freelancer's wallet. No middlemen, no delays.

17
00:02:55,000 --> 00:03:00,000
Stellar MarketPay is open source. Try it yourself at the link below. Star us on GitHub!
```

---

## 🖼️ GIF Preview Suggestion

For the GitHub preview GIF, capture **Scene 6 (2:35–2:55)** — the escrow release moment.  
This is the most impactful ~15–20 second clip showing:
- The "Release Escrow" button click
- The Freighter wallet confirmation
- The success animation

**How to create the GIF:**
```bash
# If you recorded with OBS, use ffmpeg to extract a GIF:
ffmpeg -i demo-walkthrough.mp4 -ss 00:02:35 -t 20 -vf "fps=10,scale=800:-1:flags=lanczos" -loop 0 escrow-release.gif
```

Or use a tool like [GIPHY Capture](https://giphy.com/apps/giphycapture) (macOS) or [ScreenToGif](https://www.screentogif.com/) (Windows).

---

## ✅ Pre-Recording Checklist

- [ ] Two Freighter wallets funded with Testnet XLM (use [Friendbot](https://friendbot.stellar.org/))
- [ ] Backend running: `cd backend && npm run dev`
- [ ] Frontend running: `cd frontend && npm run dev`
- [ ] Set `NEXT_PUBLIC_USE_CONTRACT_MOCK=true` in `frontend/.env.local` for a smoother demo
- [ ] Close unnecessary browser tabs and notifications
- [ ] Set screen resolution to 1920×1080
- [ ] Enable "Do Not Disturb" mode on your computer
- [ ] Test the full flow once before recording
