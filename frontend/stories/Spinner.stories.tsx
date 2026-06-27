import type { Meta, StoryObj } from "@storybook/react";
import Spinner from "@/components/Spinner";

const meta: Meta<typeof Spinner> = {
  title: "Components/Spinner",
  component: Spinner,
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "dark",
    },
  },
  argTypes: {
    className: {
      control: "text",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

// Default state - Small spinner
export const Default: Story = {
  args: {
    className: "w-4 h-4",
  },
};

// Medium spinner
export const Medium: Story = {
  args: {
    className: "w-8 h-8",
  },
};

// Large spinner
export const Large: Story = {
  args: {
    className: "w-12 h-12",
  },
};

// Extra large spinner
export const ExtraLarge: Story = {
  args: {
    className: "w-16 h-16",
  },
};

// Loading state - With text
export const Loading: Story = {
  args: {
    className: "w-4 h-4",
  },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Spinner {...args} />
      <span className="text-amber-100">Loading...</span>
    </div>
  ),
};

// In a button
export const InButton: Story = {
  args: {
    className: "w-4 h-4",
  },
  render: (args) => (
    <button className="btn-primary flex items-center gap-2" disabled>
      <Spinner {...args} />
      Processing...
    </button>
  ),
};

// Colored spinner
export const Colored: Story = {
  args: {
    className: "w-8 h-8 text-emerald-400",
  },
};

// On dark background
export const OnDarkBackground: Story = {
  args: {
    className: "w-8 h-8",
  },
  parameters: {
    backgrounds: {
      default: "dark",
    },
  },
};
