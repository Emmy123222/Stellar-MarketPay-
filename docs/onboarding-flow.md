# Freelancer Onboarding Flow Walkthrough

This document provides a comprehensive technical walkthrough of the multi-step freelancer onboarding user experience (UX) in Stellar MarketPay. It details the component architecture, state persistence lifecycle, step-by-step form specifications, validation criteria, and guidelines for extending the flow.

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [State Persistence & Recovery](#state-persistence--recovery)
- [Step Specifications](#step-specifications)
  - [Step 1: Profile (Basic Info & Role)](#step-1-profile-basic-info--role)
  - [Step 2: Skills & Competencies](#step-2-skills--competencies)
  - [Step 3: Portfolio & Work Samples](#step-3-portfolio--work-samples)
  - [Step 4: Verification & Proof of Work](#step-4-verification--proof-of-work)
  - [Step 5: Wallet & Settlement](#step-5-wallet--settlement)
- [Accessibility & Focus Management](#accessibility--focus-management)
- [Extending the Flow](#extending-the-flow)
- [Troubleshooting & FAQs](#troubleshooting--faqs)

---

## Overview & Architecture

The onboarding experience guides new freelancers and clients through setting up their identity, skills, portfolio artifacts, and Stellar wallet connection before engaging in trustless escrows and job proposals.

### Component Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Onboarding Container                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌───────────────────────┐             ┌──────────────────────────┐   │
│   │   WelcomeModal.tsx    │             │   OnboardingWizard.tsx   │   │
│   │   (First-time intro)  │             │   (Modal Step Flow)      │   │
│   └──────────┬────────────┘             └────────────┬─────────────┘   │
│              │                                       │                 │
│              ▼                                       ▼                 │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                     useOnboarding Hook                         │   │
│   │  - Local / Session Storage Checkpoint Cache                    │   │
│   │  - Profile Fetch & Server Sync (syncOnboardingProgress)        │   │
│   │  - Progress Calculation (0–100% Completeness)                  │   │
│   └──────────────────────────────┬─────────────────────────────────┘   │
│                                  │                                     │
│         ┌────────────────────────┴────────────────────────┐            │
│         ▼                                                 ▼            │
│  ┌───────────────────────────────┐     ┌────────────────────────────┐  │
│  │     ProfileChecklist.tsx      │     │ ProfileCompletenessWidget  │  │
│  │ (Interactive Dashboard Items) │     │ (Collapsible Progress Bar) │  │
│  └───────────────────────────────┘     └────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **`OnboardingWizard`** (`frontend/components/Onboarding/OnboardingWizard.tsx`):
   Modal-based wizard for new users that sequentially walks through wallet connection, role selection (`freelancer`, `client`, `both`), and initial profile completion.
2. **`useOnboarding`** (`frontend/hooks/useOnboarding.tsx`):
   Central state management hook handling client-side persistence, profile completeness calculation, checklist generation, and asynchronous backend synchronization.
3. **`ProfileChecklist`** (`frontend/components/Onboarding/ProfileChecklist.tsx`):
   Card checklist rendered on the dashboard displaying 5 actionable completion items with direct routing to `/dashboard?tab=edit_profile`.
4. **`ProfileCompletenessWidget`** (`frontend/components/ProfileCompletenessWidget.tsx`):
   Persistent, collapsible progress widget displaying real-time percentage completion with snooze ("Remind me later") capabilities.
5. **`EditProfileForm`** (`frontend/components/EditProfileForm.tsx`):
   Full profile editing interface containing input controls, file uploads, skill tags, availability dates, and portfolio links.
6. **`WelcomeModal`** (`frontend/components/Onboarding/WelcomeModal.tsx`):
   Introductory modal welcoming first-time users and introducing escrow, jobs, and wallet features.
7. **`Tooltips`** (`frontend/components/Onboarding/Tooltips.tsx`):
   Contextual spotlight tooltips highlighting key platform actions (e.g., `post-job`, `browse-jobs`).

---

## State Persistence & Recovery

The onboarding lifecycle uses a multi-tier storage pattern combining client storage (`localStorage` / `sessionStorage`) with backend database persistence (`onboarding_progress` table) to ensure resilience against browser reloads and cross-device sessions.

### Storage Keys & Data Schema

| Storage Key                                     | Type                    | Description                                                                   |
| ----------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `marketpay_onboarding_wizard`                   | JSON Object             | Stores active step index, completed step array, and wizard completion flags.  |
| `marketpay_onboarding_completed`                | JSON Object             | Stores welcome modal view status, checklist dismissal, and cached percentage. |
| `marketpay_tooltips_dismissed`                  | JSON Array (`string[]`) | List of dismissed contextual tooltip identifiers.                             |
| `marketpay_completeness_widget_dismissed_until` | ISO Date String         | Expiration timestamp for the "Remind me later" 3-day snooze period.           |

#### `marketpay_onboarding_wizard` Schema

```json
{
  "currentStep": 0,
  "completedSteps": ["connect-wallet", "choose-role"],
  "dismissed": false,
  "completed": false,
  "syncedAt": "2026-09-27T10:00:00.000Z"
}
```

#### `marketpay_onboarding_completed` Schema

```json
{
  "hasSeenWelcome": true,
  "checklistDismissed": false,
  "profileCompletionPercentage": 80,
  "syncedAt": "2026-09-27T10:00:00.000Z"
}
```

### Backend Synchronization

Whenever a step transitions or onboarding state changes, `useOnboarding` dispatches an asynchronous update to the backend endpoint:

- **Endpoint:** `PATCH /api/onboarding`
- **Request Payload:**
  ```json
  {
    "publicKey": "G...",
    "currentStep": 2,
    "completedSteps": ["connect-wallet", "choose-role"],
    "dismissed": false,
    "completed": false
  }
  ```
- **Database Table:** `onboarding_progress` (`public_key`, `current_step`, `completed_steps`, `dismissed`, `completed`, `updated_at`).

### Hydration & Decision Matrix

On component mount, `useOnboarding` evaluates the following visibility flags:

- `shouldShowWelcome`: `!loading && !serverCompleted && !hasSeenWelcome && publicKey !== null`
- `shouldShowWizard`: `!loading && !serverCompleted && !wizardCompleted && !wizardDismissed`
- `shouldShowChecklist`: `!loading && !serverCompleted && !checklistDismissed && publicKey !== null`

---

## Step Specifications

The 5-step freelancer onboarding pipeline ensures freelancers provide all necessary identity, capability, proof, and settlement data.

```
┌──────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────────┐     ┌──────────────┐
│ 1. Profile   │ ──► │ 2. Skills    │ ──► │ 3. Portfolio  │ ──► │ 4. Verification  │ ──► │ 5. Wallet    │
│ Basic & Role │     │ Competencies │     │ Work Samples  │     │ On-Chain Proofs  │     │ Settlement   │
└──────────────┘     └──────────────┘     └───────────────┘     └──────────────────┘     └──────────────┘
```

---

### Step 1: Profile (Basic Info & Role)

- **Component & Location:** `OnboardingWizard.tsx` (`frontend/components/Onboarding/OnboardingWizard.tsx`) & `EditProfileForm.tsx` (`frontend/components/EditProfileForm.tsx`).
- **Form Fields Collected:**
  - `displayName` (string): Freelancer's public display name.
  - `bio` (string): Short professional overview and background.
  - `role` (`UserRole`): `"freelancer"` | `"client"` | `"both"`.
  - `availability` (`Availability`): Status (`"available"`, `"busy"`, `"unavailable"`), `availableFrom` (date), `availableUntil` (date).
- **Validation Rules & Error Triggers:**
  - `displayName`: Length must be between 3 and 30 characters (`3 <= length <= 30`).
    - _Error Trigger:_ `"Display Name must be between 3 and 30 characters."`
  - `bio`: Maximum 300 characters (`length <= 300`).
    - _Error Trigger:_ `"Bio cannot exceed 300 characters."`
  - `role`: One role option must be selected (`selectedRole !== null`).
  - `availability`: `availableFrom` must precede `availableUntil` if both dates are specified.
    - _Error Trigger:_ `"Available from must be before available until."`
- **Navigation Actions:**
  - **Continue / Next:** Validates input, updates profile via `upsertProfile`, and advances to next step.
  - **Skip:** Advances without submitting non-mandatory bio/name.
  - **Dismiss:** Closes modal and records `wizardDismissed: true`.

---

### Step 2: Skills & Competencies

- **Component & Location:** `EditProfileForm.tsx` (`frontend/components/EditProfileForm.tsx`).
- **Form Fields Collected:**
  - `skills` (`string[]`): Array of verified competency tags (e.g., `["Rust", "Soroban", "Next.js", "TypeScript"]`).
  - `skillInput` (string): Temporary text input for skill tag entry.
- **Validation Rules & Error Triggers:**
  - Non-empty trimmed string upon pressing <kbd>Enter</kbd>.
  - Duplicate skill prevention: Ignored if `skills.includes(val)`.
  - Completion criteria: Profile progress requires `skills.length > 0`.
- **Navigation Actions:**
  - **Add Skill:** Pressing <kbd>Enter</kbd> appends trimmed skill tag to `skills` array.
  - **Remove Skill:** Clicking `×` removes the targeted skill tag.
  - **Save Profile:** Persists skill tags to backend profile.

---

### Step 3: Portfolio & Work Samples

- **Component & Location:** `EditProfileForm.tsx` (`frontend/components/EditProfileForm.tsx`).
- **Form Fields Collected:**
  - `portfolioItems` (`PortfolioItem[]`):
    - `title` (string): Max 80 characters.
    - `type` (`"github"` | `"live"` | `"stellar_tx"` | `"file"`): Selected sample type.
    - `url` (string): Target URL or Stellar transaction hash.
  - `portfolioFiles` (`PortfolioFile[]`): Uploaded project artifacts, resumes, or mockups.
- **Validation Rules & Error Triggers:**
  - Maximum 10 portfolio items (`MAX_PORTFOLIO_ITEMS = 10`).
    - _Error Trigger:_ `"You can add up to 10 portfolio items."`
  - Maximum 10 uploaded files (`MAX_PORTFOLIO_FILES = 10`).
    - _Error Trigger:_ `"Maximum 10 files allowed. You have X and tried to add Y."`
  - File size limit: Max 5MB (`MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024`).
    - _Error Trigger:_ `"<filename>" exceeds 5MB limit (<size>MB)`
  - Item integrity: Every item must have a non-empty `title`, `type`, and `url`.
    - _Error Trigger:_ `"Each portfolio item needs a title, type, and URL or transaction ID."`
- **Navigation Actions:**
  - **Add Item:** Appends empty `PortfolioItem` slot.
  - **Upload Files:** Drag-and-drop or file browser trigger with per-file progress indicator.
  - **Remove File / Item:** Deletes item from list.

---

### Step 4: Verification & Proof of Work

- **Component & Location:** `EditProfileForm.tsx` (`frontend/components/EditProfileForm.tsx`) & `ProfileChecklist.tsx` (`frontend/components/Onboarding/ProfileChecklist.tsx`).
- **Form Fields Collected:**
  - Stellar Transaction Hashes (`stellar_tx`): Verifiable on-chain escrow releases or contract calls.
  - GitHub Repository URLs (`github`): Verified source code links.
  - IPFS CIDs: Cryptographically verified pinned evidence and deliverable artifacts.
- **Validation Rules & Error Triggers:**
  - Stellar Transaction ID: Valid 64-character hexadecimal transaction hash.
  - GitHub URL: Valid URI pointing to github.com repository.
  - IPFS CID: Valid base58/base32 content identifier.
- **Navigation Actions:**
  - **Verify Proof:** Triggers on-chain verification or links to Stellar Expert explorer.
  - **Continue:** Records verified items in profile.

---

### Step 5: Wallet & Settlement

- **Component & Location:** `OnboardingWizard.tsx` (`frontend/components/Onboarding/OnboardingWizard.tsx`) & `WalletConnect.tsx` (`frontend/components/WalletConnect.tsx`).
- **Form Fields Collected:**
  - `publicKey` (string): Stellar G-address (e.g. `G...`).
- **Validation Rules & Error Triggers:**
  - Stellar StrKey ed25519 Public Key validation: Must be 56 characters starting with `G`.
  - Browser wallet extension access: Requires Freighter, xBull, or Albedo approval.
  - _Error Trigger:_ Connection rejection or missing extension error.
- **Navigation Actions:**
  - **Connect Wallet:** Triggers `onConnect()` wallet authentication request.
  - **Complete Onboarding:** Flips `wizardCompleted: true`, `hasSeenWelcome: true`, displays celebratory "All set!" banner, and redirects to dashboard.

---

## Profile Completeness Criteria

The platform calculates overall freelancer completeness score based on 5 weighted pillars (20% each):

$$\text{Completeness} = \frac{\sum_{i=1}^{5} \mathbb{I}(\text{criterion}_i)}{5} \times 100\%$$

| Criterion        | Code Identifier   | Passing Threshold            |
| ---------------- | ----------------- | ---------------------------- |
| **Display Name** | `hasAvatar`       | `displayName.length >= 3`    |
| **Bio**          | `hasBio`          | `bio.length >= 10`           |
| **Skills**       | `hasSkills`       | `skills.length > 0`          |
| **Portfolio**    | `hasPortfolio`    | `portfolioItems.length > 0   |     | portfolioFiles.length > 0` |
| **Availability** | `hasAvailability` | `availability.status` is set |

- **Onboarding Threshold:** Reaching $\ge 80\%$ automatically marks onboarding as complete enough to suppress intrusive modals.
- **Widget Auto-Hide:** When completion reaches $100\%$, `ProfileCompletenessWidget` transitions to a congratulations banner and collapses.

---

## Accessibility & Focus Management

All onboarding modal dialogs follow Web Content Accessibility Guidelines (WCAG 2.1 AA):

1. **Focus Trapping:** `OnboardingWizard` and `WelcomeModal` trap keyboard focus inside the active dialog using a keydown listener.
2. **Keyboard Navigation:**
   - <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> cycles focus exclusively between interactive elements inside the modal.
   - <kbd>Escape</kbd> triggers modal dismissal.
3. **ARIA Semantics:**
   - Container has `role="dialog"` and `aria-modal="true"`.
   - Header is tied via `aria-labelledby="onboarding-wizard-title"`.
   - Progress bar includes `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, and `aria-valuemax="100"`.
4. **Body Scroll Lock:** Scroll is locked (`document.body.style.overflow = "hidden"`) while modals are open.

---

## Extending the Flow

To add a new step (e.g., "Tax Information" or "Identity Verification") to the onboarding flow:

### 1. Update Step Configuration in `OnboardingWizard.tsx`

Add the new step definition to the `steps` array:

```typescript
const steps = [
  {
    id: "connect-wallet",
    title: "Connect Wallet",
    subtitle: "Connect your Stellar wallet to get started",
  },
  {
    id: "choose-role",
    title: "Choose Your Role",
    subtitle: "Tell us how you want to use MarketPay",
  },
  {
    id: "tax-info",
    title: "Tax & Compliance",
    subtitle: "Provide required compliance details",
  },
  {
    id: "complete-profile",
    title: "Complete Profile",
    subtitle: "Add a few details to help others find you",
  },
];
```

### 2. Implement Step UI & State Handling

Add corresponding state hooks, input validation, and render blocks inside `OnboardingWizard.tsx`:

```tsx
{
  step.id === "tax-info" && (
    <div className="space-y-4">
      <label
        htmlFor="tax-id"
        className="block text-sm font-medium text-amber-200"
      >
        Tax Identification Number (Optional)
      </label>
      <input
        id="tax-id"
        type="text"
        value={taxId}
        onChange={(e) => setTaxId(e.target.value)}
        className="w-full bg-ink-800 border border-market-500/20 rounded-xl px-4 py-3 text-amber-100"
      />
    </div>
  );
}
```

### 3. Update `handlePrimary` Navigation Logic

Wire the step validation and submission in `handlePrimary`:

```typescript
} else if (step.id === "tax-info") {
  if (publicKey && taxId) {
    await updateTaxInfo({ publicKey, taxId });
  }
  persist(currentIndex + 1);
}
```

### 4. Update Checklist Items in `useOnboarding.tsx`

If the new step contributes to the dashboard checklist, add a corresponding `ChecklistItem` in `checklistItems`:

```typescript
{
  id: "tax_info",
  label: "Verify tax details",
  completed: Boolean(profile.taxId),
  route: "/dashboard?tab=tax_info",
  icon: <TaxIcon className="w-5 h-5" />,
}
```

---

## Troubleshooting & FAQs

### How do users restart the onboarding wizard?

Users can restart the onboarding walkthrough at any time by navigating to **Dashboard Settings → Security** and clicking **"Restart Onboarding Tour"**. This invokes `resetOnboarding()`, clearing all `localStorage` keys and refreshing the session.

### What happens if the backend API is unreachable?

`useOnboarding` gracefully degrades by falling back to cached `localStorage` state. User progress is cached locally and will re-sync with `PATCH /api/onboarding` on the next successful network request.
