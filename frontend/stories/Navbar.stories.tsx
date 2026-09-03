import type { Meta, StoryObj } from "@storybook/react";
import Navbar from "../components/Navbar";

const meta: Meta<typeof Navbar> = {
  title: "Components/Navbar",
  component: Navbar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Navbar>;

export const LoggedOut: Story = {
  args: {
    publicKey: null,
  },
};

export const LoggedIn: Story = {
  args: {
    publicKey: "GCFXWALLETTESTADDRESS1234567890EXAMPLEABCDEF",
  },
};