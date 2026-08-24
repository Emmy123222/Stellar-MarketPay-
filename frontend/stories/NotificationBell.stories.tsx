import { Meta, StoryObj } from "@storybook/react";
import NotificationBell from "@/components/NotificationBell";
import { fetchNotifications } from "@/lib/api";

// Mock the fetchNotifications module
jest.mock("@/lib/api", () => ({
  fetchNotifications: jest.fn(),
}));

const mockNotifications = {
  notifications: [
    {
      id: "1",
      title: "New job posted",
      body: "A new job is available",
      createdAt: "2026-07-28T12:00:00Z",
      read: false,
    },
    {
      id: "2",
      title: "Payment reminder",
      body: "Your payment is due soon",
      createdAt: "2026-07-27T15:30:00Z",
      read: true,
    },
  ],
  unreadCount: 1,
  nextCursor: null,
  hasMore: false,
};

const meta: Meta<typeof NotificationBell> = {
  title: "Components/NotificationBell",
  component: NotificationBell,
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "dark",
    },
  },
  argTypes: {
    publicKey: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof NotificationBell>;

const Template: Story = {
  render: (args) => <NotificationBell {...args} />,
};

export const Default: Story = {
  args: {
    publicKey: "GFREELANCER123456789ABC",
  },
  play: async () => {
    // @ts-ignore
    fetchNotifications.mockResolvedValueOnce({ data: { ...mockNotifications } });
  },
};

export const Loading: Story = {
  args: {
    publicKey: "GFREELANCER123456789ABC",
  },
  play: async () => {
    // @ts-ignore
    fetchNotifications.mockImplementation(() => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // @ts-ignore
          fetchNotifications.mockResolvedValueOnce({ data: { ...mockNotifications } });
          resolve();
        }, 1000);
      });
    });
  },
};

export const Error: Story = {
  args: {
    publicKey: "GFREELANCER123456789ABC",
  },
  play: async () => {
    // @ts-ignore
    fetchNotifications.mockRejectedValueOnce(new Error("Network error"));
  },
};