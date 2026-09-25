import type { Meta, StoryObj } from "@storybook/react";
import WalletConnect from "../components/WalletConnect";

const meta: Meta<typeof WalletConnect> = {
  title: "Components/WalletConnect",
  component: WalletConnect,
  tags: ["autodocs"],
  argTypes: {
    onConnect: { action: "connected" },
  },
};

export default meta;
type Story = StoryObj<typeof WalletConnect>;

export const Default: Story = {
  args: {
    onConnect: (pk: string) => console.log("Connected:", pk),
  },
};