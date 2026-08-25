import type { Meta, StoryObj } from "@storybook/react";
import Toast from "../components/Toast";

const meta: Meta<typeof Toast> = {
  title: "Components/Toast",
  component: Toast,
  tags: ["autodocs"],
  argTypes: {
    type: {
      control: "select",
      options: ["success", "error", "info", "warning"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Success: Story = {
  args: {
    message: "Job posted successfully!",
    type: "success",
    onClose: () => console.log("closed"),
  },
};

export const Error: Story = {
  args: {
    message: "Transaction failed. Please try again.",
    type: "error",
    onClose: () => console.log("closed"),
  },
};

export const Info: Story = {
  args: {
    message: "Your application has been submitted.",
    type: "info",
    onClose: () => console.log("closed"),
  },
};