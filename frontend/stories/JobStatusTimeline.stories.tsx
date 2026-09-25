import type { Meta, StoryObj } from "@storybook/react";
import JobStatusTimeline from "@/components/JobStatusTimeline";
import type { Job, TimelineEvent } from "@/utils/types";

const baseJob: Job = {
  id: "story-job-id",
  title: "Build a Stellar Payment Widget",
  description: "Implement a payment widget using Stellar SDK",
  budget: "500",
  currency: "XLM",
  category: "Development",
  skills: ["TypeScript", "Stellar"],
  clientAddress: "GCLIENT...ADDRESS",
  applicantCount: 0,
  createdAt: "2024-01-01T10:00:00Z",
  updatedAt: "2024-01-10T12:00:00Z",
  status: "open",
};

const baseTimeline: TimelineEvent[] = [
  {
    id: "evt-1",
    jobId: "story-job-id",
    eventType: "job_posted",
    txHash: null,
    createdAt: "2024-01-01T10:00:00Z",
  },
  {
    id: "evt-2",
    jobId: "story-job-id",
    eventType: "bid_accepted",
    txHash: null,
    createdAt: "2024-01-10T12:00:00Z",
  },
  {
    id: "evt-3",
    jobId: "story-job-id",
    eventType: "escrow_funded",
    txHash: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    createdAt: "2024-01-12T14:30:00Z",
  },
  {
    id: "evt-4",
    jobId: "story-job-id",
    eventType: "work_completed",
    txHash: null,
    createdAt: "2024-01-15T09:00:00Z",
  },
  {
    id: "evt-5",
    jobId: "story-job-id",
    eventType: "escrow_released",
    txHash: "789ghi012jkl789ghi012jkl789ghi012jkl789ghi012jkl789ghi012jkl7",
    createdAt: "2024-02-01T16:30:00Z",
  },
];

const meta: Meta<typeof JobStatusTimeline> = {
  title: "Components/JobStatusTimeline",
  component: JobStatusTimeline,
  parameters: {
    layout: "padded",
  },
  argTypes: {
    compact: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof JobStatusTimeline>;

export const Open: Story = {
  args: {
    job: { ...baseJob, status: "open" },
    timeline: [baseTimeline[0]],
  },
};

export const OpenCompact: Story = {
  name: "Open (compact)",
  args: {
    job: { ...baseJob, status: "open" },
    compact: true,
    timeline: [baseTimeline[0]],
  },
};

export const InProgress: Story = {
  args: {
    job: {
      ...baseJob,
      status: "in_progress",
      freelancerAddress: "GFREELANCER...ADDRESS",
      updatedAt: "2024-01-15T09:00:00Z",
    },
    timeline: [baseTimeline[0], baseTimeline[1], baseTimeline[2]],
  },
};

export const InProgressCompact: Story = {
  name: "In Progress (compact)",
  args: {
    job: {
      ...baseJob,
      status: "in_progress",
      freelancerAddress: "GFREELANCER...ADDRESS",
      updatedAt: "2024-01-15T09:00:00Z",
    },
    compact: true,
    timeline: [baseTimeline[0], baseTimeline[1], baseTimeline[2]],
  },
};

export const Completed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "completed",
      freelancerAddress: "GFREELANCER...ADDRESS",
      updatedAt: "2024-02-01T16:30:00Z",
    },
    timeline: baseTimeline,
  },
};

export const CompletedCompact: Story = {
  name: "Completed (compact)",
  args: {
    job: {
      ...baseJob,
      status: "completed",
      freelancerAddress: "GFREELANCER...ADDRESS",
      updatedAt: "2024-02-01T16:30:00Z",
    },
    compact: true,
    timeline: baseTimeline,
  },
};

export const CompletedWithOnChainLinks: Story = {
  name: "Completed with on-chain links",
  args: {
    job: {
      ...baseJob,
      status: "completed",
      freelancerAddress: "GFREELANCER...ADDRESS",
      updatedAt: "2024-02-01T16:30:00Z",
    },
    timeline: baseTimeline,
  },
};

export const Cancelled: Story = {
  args: {
    job: {
      ...baseJob,
      status: "cancelled",
      updatedAt: "2024-01-08T11:00:00Z",
    },
    timeline: [baseTimeline[0]],
  },
};

export const CancelledCompact: Story = {
  name: "Cancelled (compact)",
  args: {
    job: {
      ...baseJob,
      status: "cancelled",
      updatedAt: "2024-01-08T11:00:00Z",
    },
    compact: true,
    timeline: [baseTimeline[0]],
  },
};

export const Disputed: Story = {
  args: {
    job: {
      ...baseJob,
      status: "disputed",
      freelancerAddress: "GFREELANCER...ADDRESS",
      updatedAt: "2024-01-20T14:00:00Z",
      disputedAt: "2024-01-20T14:00:00Z",
    },
    timeline: [baseTimeline[0], baseTimeline[1], baseTimeline[2]],
  },
};

export const DisputedCompact: Story = {
  name: "Disputed (compact)",
  args: {
    job: {
      ...baseJob,
      status: "disputed",
      freelancerAddress: "GFREELANCER...ADDRESS",
      updatedAt: "2024-01-20T14:00:00Z",
      disputedAt: "2024-01-20T14:00:00Z",
    },
    compact: true,
    timeline: [baseTimeline[0], baseTimeline[1], baseTimeline[2]],
  },
};
