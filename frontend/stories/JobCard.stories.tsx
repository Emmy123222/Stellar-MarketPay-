import type { Meta, StoryObj } from "@storybook/react";
import JobCard, { JobCardSkeleton } from "@/components/JobCard";
import type { Job } from "@/utils/types";

const baseJob: Job = {
  id: "story-job-id-1",
  title: "Build a Stellar Payment Widget",
  description:
    "Implement a responsive payment widget using Stellar SDK. Should include XLM conversion rates, fee estimation, and QR code generation for easy payment sharing.",
  budget: "500",
  currency: "XLM",
  category: "Development",
  skills: ["TypeScript", "Stellar", "React"],
  clientAddress: "GCLIENT123456789ABC",
  applicantCount: 3,
  createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  status: "open",
  clientReputationScore: 4.8,
};

const meta: Meta<typeof JobCard> = {
  title: "Components/JobCard",
  component: JobCard,
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "dark",
    },
  },
  argTypes: {
    isFocused: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof JobCard>;

// Default state - Open job with good client reputation
export const Default: Story = {
  args: {
    job: baseJob,
  },
};

// Loading state - Skeleton
export const Loading: Story = {
  render: () => <JobCardSkeleton />,
};

// Open job with multiple applicants
export const OpenWithApplicants: Story = {
  args: {
    job: {
      ...baseJob,
      applicantCount: 12,
    },
  },
};

// Closing soon - deadline within 48 hours
export const ClosingSoon: Story = {
  args: {
    job: {
      ...baseJob,
      deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours
    },
  },
};

// Closed job
export const Closed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "completed",
    },
  },
};

// Error state - Low client reputation
export const LowClientReputation: Story = {
  args: {
    job: {
      ...baseJob,
      clientReputationScore: 2.5,
    },
  },
};

// Featured/Boosted job
export const Featured: Story = {
  args: {
    job: {
      ...baseJob,
      boosted: true,
      boostedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
};

// Focused state (keyboard navigation)
export const Focused: Story = {
  args: {
    job: baseJob,
    isFocused: true,
  },
};

// Job with many skills
export const ManySkills: Story = {
  args: {
    job: {
      ...baseJob,
      skills: [
        "TypeScript",
        "React",
        "Node.js",
        "Stellar",
        "Solidity",
        "Docker",
        "GraphQL",
      ],
    },
  },
};
