import type { Meta, StoryObj } from "@storybook/react";
import { ToastSnapshot } from "@/components/Toast";

const meta: Meta<typeof ToastSnapshot> = {
  title: "Components/Toast",
  component: ToastSnapshot,
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "dark",
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["success", "error", "info"],
    },
    message: {
      control: "text",
    },
  },
};

export default meta;
type Story = StoryObj<typeof ToastSnapshot>;

// Default state - Success toast
export const Success: Story = {
  args: {
    variant: "success",
    message: "Payment submitted successfully!",
  },
};

// Error state - Error toast
export const Error: Story = {
  args: {
    variant: "error",
    message: "Failed to process payment. Please try again.",
  },
};

// Info state - Info toast
export const Info: Story = {
  args: {
    variant: "info",
    message: "This is an informational message.",
  },
};

// Long message
export const LongMessage: Story = {
  args: {
    variant: "success",
    message:
      "Your job has been successfully posted and is now visible to all freelancers in the network. You can manage your job from the dashboard.",
  },
};

// Short message
export const ShortMessage: Story = {
  args: {
    variant: "error",
    message: "Error occurred",
  },
};

// Special characters in message
export const SpecialCharacters: Story = {
  args: {
    variant: "info",
    message: "Received: 1250.50 XLM ≈ $456.78 USD",
  },
};
