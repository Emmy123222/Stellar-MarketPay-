import type { Job, UserProfile, Application } from "@/utils/types";
import type { ChecklistItem } from "@/components/Onboarding/ProfileChecklist";

export const MOCK_PK =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
export const MOCK_PK_B =
  "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

export const sampleJob: Job = {
  id: "job-1",
  title: "Build a Soroban escrow contract for marketplace payouts",
  description:
    "Need a secure escrow contract and integration tests for release and refund paths on testnet.",
  budget: "500.0000000",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Testing"],
  status: "open",
  clientAddress: MOCK_PK,
  applicantCount: 2,
  createdAt: "2026-01-12T10:00:00.000Z",
  updatedAt: "2026-01-12T10:00:00.000Z",
};

export const sampleProfile: UserProfile = {
  publicKey: MOCK_PK_B,
  role: "freelancer",
  displayName: "Jane Doe",
  bio: "Full-stack Stellar developer with Soroban experience.",
  skills: ["React", "Soroban"],
  completedJobs: 5,
  totalEarnedXLM: "250.0000000",
  rating: 4.8,
  tier: "Top Rated",
  availability: { status: "available" },
  createdAt: "2025-06-01T00:00:00.000Z",
};

export const sampleApplication: Application = {
  id: "app-1",
  jobId: "job-1",
  freelancerAddress: MOCK_PK_B,
  proposal: "I have five years of experience building on Stellar.",
  bidAmount: "450.0000000",
  currency: "XLM",
  status: "pending",
  createdAt: "2026-01-10T00:00:00.000Z",
};

export const checklistItems: ChecklistItem[] = [
  {
    id: "wallet",
    label: "Connect wallet",
    completed: false,
    route: "/dashboard",
    icon: "🔑" as unknown as React.ReactNode,
  },
  {
    id: "bio",
    label: "Add bio",
    completed: true,
    route: "/profile/edit",
    icon: "📝" as unknown as React.ReactNode,
  },
];

export const clientSpendingAnalytics = {
  hasCompletedJobs: true,
  totalSpentXlm: "500.0000000",
  jobsBreakdown: { posted: 3, completed: 2, cancelled: 0, inProgress: 1 },
  averageBudgetXlm: "100.0000000",
  averagePaidXlm: "95.0000000",
  topFreelancers: [
    {
      freelancerAddress: MOCK_PK_B,
      displayName: "Jane Doe",
      jobsCount: 2,
      totalPaidXlm: "190.0000000",
    },
  ],
};
