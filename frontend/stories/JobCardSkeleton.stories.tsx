import type { Meta, StoryObj } from "@storybook/react";
import { JobCardSkeleton } from "../components/JobCard";

const meta: Meta<typeof JobCardSkeleton> = {
  title: "Components/JobCardSkeleton",
  component: JobCardSkeleton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof JobCardSkeleton>;

export const Default: Story = {
  args: {},
};