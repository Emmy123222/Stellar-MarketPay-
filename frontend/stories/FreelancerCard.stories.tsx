import type { Meta, StoryObj } from "@storybook/react";
import FreelancerCard from "@/components/FreelancerCard";
import type { UserProfile } from "@/utils/types";

const baseProfile: UserProfile = {
  publicKey: "GFREELANCER123456789ABC",
  displayName: "Alex Johnson",
  bio: "Full-stack developer with 5+ years of experience in blockchain and web technologies.",
  skills: ["TypeScript", "React", "Node.js", "Stellar", "GraphQL"],
  completedJobs: 24,
  totalEarnedXLM: "1250.5",
  rating: 4.8,
  availability: {
    status: "available",
  },
  tier: "pro",
};

const meta: Meta<typeof FreelancerCard> = {
  title: "Components/FreelancerCard",
  component: FreelancerCard,
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "dark",
    },
  },
};

export default meta;
type Story = StoryObj<typeof FreelancerCard>;

// Default state - Available pro freelancer
export const Default: Story = {
  args: {
    profile: baseProfile,
  },
};

// Loading state - Minimal profile
export const Loading: Story = {
  args: {
    profile: {
      ...baseProfile,
      displayName: undefined,
      bio: undefined,
      skills: [],
      rating: undefined,
    },
  },
};

// Busy/Unavailable freelancer
export const Busy: Story = {
  args: {
    profile: {
      ...baseProfile,
      availability: {
        status: "busy",
      },
    },
  },
};

// High rating
export const HighRating: Story = {
  args: {
    profile: {
      ...baseProfile,
      rating: 4.9,
      completedJobs: 87,
    },
  },
};

// Low rating (Error state)
export const LowRating: Story = {
  args: {
    profile: {
      ...baseProfile,
      rating: 2.1,
    },
  },
};

// No bio or skills
export const Minimal: Story = {
  args: {
    profile: {
      ...baseProfile,
      bio: undefined,
      skills: [],
    },
  },
};

// Many skills
export const ManySkills: Story = {
  args: {
    profile: {
      ...baseProfile,
      skills: [
        "TypeScript",
        "React",
        "Node.js",
        "Stellar",
        "Solidity",
        "Docker",
        "GraphQL",
        "Python",
      ],
    },
  },
};

// Junior freelancer (No tier)
export const Junior: Story = {
  args: {
    profile: {
      ...baseProfile,
      tier: undefined,
      completedJobs: 3,
      totalEarnedXLM: "125.25",
      rating: 4.2,
    },
  },
};

// New freelancer (no rating yet)
export const NewFreelancer: Story = {
  args: {
    profile: {
      ...baseProfile,
      completedJobs: 0,
      totalEarnedXLM: "0",
      rating: undefined,
    },
  },
};
