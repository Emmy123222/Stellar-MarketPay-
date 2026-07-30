import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationBell from "@/components/NotificationBell";

const mockMarkAllRead = jest.fn().mockResolvedValue({ updatedCount: 5 });
const mockFetchNotifications = jest.fn();

jest.mock("@/lib/api", () => ({
  markAllNotificationsRead: () => mockMarkAllRead(),
  fetchNotifications: () => mockFetchNotifications(),
  markNotificationRead: jest.fn().mockResolvedValue(undefined),
  setJwtToken: jest.fn(),
  getJwtToken: jest.fn().mockReturnValue(null),
}));

const mockPush = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: mockPush, pathname: "/" }),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function makeNotifications(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    title: `Notification ${i}`,
    body: `Body ${i}`,
    read: false,
    createdAt: new Date().toISOString(),
    jobId: null,
    linkPath: null,
  }));
}

describe("NotificationBell", () => {
  it("shows badge with unread count", async () => {
    mockFetchNotifications.mockResolvedValue({
      notifications: makeNotifications(3),
      unreadCount: 3,
      nextCursor: null,
    });

    render(<NotificationBell publicKey="GPUBKEY" />);

    const badge = await screen.findByText("3");
    expect(badge).toBeInTheDocument();
  });

  it("optimistically resets count to 0 on 'Mark all read' click", async () => {
    const notifications = makeNotifications(3);
    mockFetchNotifications.mockResolvedValue({
      notifications,
      unreadCount: 3,
      nextCursor: null,
    });

    render(<NotificationBell publicKey="GPUBKEY" />);

    const bell = await screen.findByLabelText("Notifications");
    await userEvent.click(bell);

    const markAllBtn = await screen.findByText("Mark all read");
    await userEvent.click(markAllBtn);

    expect(screen.queryByText("3")).not.toBeInTheDocument();
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("restores count if API call fails", async () => {
    const notifications = makeNotifications(3);
    mockFetchNotifications.mockResolvedValue({
      notifications,
      unreadCount: 3,
      nextCursor: null,
    });
    mockMarkAllRead.mockRejectedValueOnce(new Error("Network error"));

    render(<NotificationBell publicKey="GPUBKEY" />);

    const bell = await screen.findByLabelText("Notifications");
    await userEvent.click(bell);

    const markAllBtn = await screen.findByText("Mark all read");
    await userEvent.click(markAllBtn);

    const badge = await screen.findByText("3");
    expect(badge).toBeInTheDocument();
  });
});