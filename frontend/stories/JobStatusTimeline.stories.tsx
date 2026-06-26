import type { Meta, StoryObj } from "@storybook/react";
import JobStatusTimeline from "@/components/JobStatusTimeline";
import type { Job } from "@/utils/types";

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
  },
};

export const OpenCompact: Story = {
  name: "Open (compact)",
  args: {
    job: { ...baseJob, status: "open" },
    compact: true,
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
  },
};

export const Cancelled: Story = {
  args: {
    job: {
      ...baseJob,
      status: "cancelled",
      updatedAt: "2024-01-08T11:00:00Z",
    },
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
  },
};
