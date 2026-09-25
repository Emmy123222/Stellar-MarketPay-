import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NotificationBell from "../NotificationBell";
import { fetchNotifications, markAllNotificationsRead } from "@/lib/api";
import { mutate } from "swr";

// Mock the API calls
jest.mock("@/lib/api", () => ({
  fetchNotifications: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  markNotificationRead: jest.fn(),
}));

// Mock SWR mutate
jest.mock("swr", () => ({
  mutate: jest.fn(),
}));

// Mock Next.js router
jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

describe("NotificationBell", () => {
  const MOCK_PK = "GC3ABCDEF";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("optimistically updates unread count and revalidates SWR cache when marking all as read", async () => {
    // Setup initial state with 5 unread notifications
    const mockNotifications = [
      { id: "1", title: "N1", read: false, createdAt: new Date().toISOString() },
      { id: "2", title: "N2", read: false, createdAt: new Date().toISOString() },
      { id: "3", title: "N3", read: false, createdAt: new Date().toISOString() },
      { id: "4", title: "N4", read: false, createdAt: new Date().toISOString() },
      { id: "5", title: "N5", read: false, createdAt: new Date().toISOString() },
    ];

    (fetchNotifications as jest.Mock).mockResolvedValueOnce({
      notifications: mockNotifications,
      unreadCount: 5,
    });

    (markAllNotificationsRead as jest.Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(<NotificationBell publicKey={MOCK_PK} />);

    // Wait for notifications to load
    const badge = await screen.findByText("5");
    expect(badge).toBeInTheDocument();

    // Open the panel
    const bellButton = screen.getByRole("button", { name: /unread notification|notifications/i });
    fireEvent.click(bellButton);

    // Find and click "Mark all read"
    const markAllReadBtn = await screen.findByText("Mark all read");
    fireEvent.click(markAllReadBtn);

    // Verify optimistic update: badge should disappear immediately (or become 0 and not render)
    await waitFor(() => {
      expect(screen.queryByText("5")).not.toBeInTheDocument();
    });

    // Verify SWR cache revalidation
    expect(mutate).toHaveBeenCalledWith(
      "/api/notifications/unread-count",
      { unreadCount: 0 },
      { revalidate: true }
    );

    // Verify API call was made
    expect(markAllNotificationsRead).toHaveBeenCalled();
  });

  it("caps unread count badge at 99+ and shows full count in aria-label (Issue #1409)", async () => {
    (fetchNotifications as jest.Mock).mockResolvedValueOnce({
      notifications: [],
      unreadCount: 142,
    });

    render(<NotificationBell publicKey={MOCK_PK} />);

    // Unit test: unreadCount = 142 → badge text is "99+"
    const badge = await screen.findByText("99+");
    expect(badge).toBeInTheDocument();

    // aria-label reads "142 unread notifications" for screen readers (full number in the label)
    expect(badge).toHaveAttribute("aria-label", "142 unread notifications");
    expect(screen.getByRole("button", { name: "142 unread notifications" })).toBeInTheDocument();
  });
});
