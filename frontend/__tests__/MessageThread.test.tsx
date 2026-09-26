import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import MessageThread from "@/components/MessageThread";
import * as api from "@/lib/api";

jest.mock("@/lib/api", () => ({
  fetchMessages: jest.fn(),
  sendMessage: jest.fn(),
  attachMessageTxHash: jest.fn(),
  fetchRecipientEncryptionKey: jest.fn(),
  publishMyEncryptionKey: jest.fn().mockResolvedValue({}),
  uploadMessageAttachment: jest.fn(),
}));

jest.mock("@/lib/stellar", () => ({
  publishMessageOnChain: jest.fn(),
}));

jest.mock("@/lib/crypto", () => ({
  myPublicKeyBase64: jest.fn(() => "mock-pub-key"),
  encryptForRecipient: jest.fn(),
  decryptFromSender: jest.fn(),
}));

describe("MessageThread Component — Cursor Pagination & Infinite Scroll (Issue #1446)", () => {
  const JOB_ID = "test-job-123";
  const USER_A = "GA" + "1".repeat(54);
  const USER_B = "GB" + "2".repeat(54);

  const mockMsg1 = {
    id: "msg-1",
    jobId: JOB_ID,
    senderAddress: USER_A,
    receiverAddress: USER_B,
    content: "Old message 1",
    read: true,
    createdAt: "2026-09-25T08:00:00.000Z",
  };

  const mockMsg2 = {
    id: "msg-2",
    jobId: JOB_ID,
    senderAddress: USER_B,
    receiverAddress: USER_A,
    content: "Recent message 2",
    read: true,
    createdAt: "2026-09-25T09:00:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads initial messages with limit=50 and renders them", async () => {
    (api.fetchMessages as jest.Mock).mockResolvedValueOnce({
      messages: [mockMsg2],
      nextCursor: null,
    });

    render(
      <MessageThread
        jobId={JOB_ID}
        currentUserAddress={USER_A}
        otherUserAddress={USER_B}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Recent message 2")).toBeInTheDocument();
    });

    expect(api.fetchMessages).toHaveBeenCalledWith(JOB_ID, { limit: 50 });
    expect(screen.queryByText("Load earlier messages")).not.toBeInTheDocument();
  });

  it("displays 'Load earlier messages' button when nextCursor is present", async () => {
    (api.fetchMessages as jest.Mock).mockResolvedValueOnce({
      messages: [mockMsg2],
      nextCursor: "2026-09-25T08:00:00.000Z",
    });

    render(
      <MessageThread
        jobId={JOB_ID}
        currentUserAddress={USER_A}
        otherUserAddress={USER_B}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Recent message 2")).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByText("Load earlier messages");
    expect(loadMoreButton).toBeInTheDocument();
  });

  it("loads older messages with before cursor when 'Load earlier messages' is clicked", async () => {
    (api.fetchMessages as jest.Mock)
      .mockResolvedValueOnce({
        messages: [mockMsg2],
        nextCursor: "2026-09-25T08:00:00.000Z",
      })
      .mockResolvedValueOnce({
        messages: [mockMsg1],
        nextCursor: null,
      });

    render(
      <MessageThread
        jobId={JOB_ID}
        currentUserAddress={USER_A}
        otherUserAddress={USER_B}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Recent message 2")).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByText("Load earlier messages");
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      expect(screen.getByText("Old message 1")).toBeInTheDocument();
    });

    expect(api.fetchMessages).toHaveBeenCalledTimes(2);
    expect(api.fetchMessages).toHaveBeenLastCalledWith(JOB_ID, {
      limit: 50,
      before: "2026-09-25T08:00:00.000Z",
    });

    // Button should disappear because nextCursor is now null
    expect(screen.queryByText("Load earlier messages")).not.toBeInTheDocument();
  });

  it("sends a new message and appends it to the thread", async () => {
    (api.fetchMessages as jest.Mock).mockResolvedValueOnce({
      messages: [mockMsg2],
      nextCursor: null,
    });

    const sentMsg = {
      id: "msg-3",
      jobId: JOB_ID,
      senderAddress: USER_A,
      receiverAddress: USER_B,
      content: "Brand new message",
      read: false,
      createdAt: "2026-09-25T10:00:00.000Z",
    };
    (api.sendMessage as jest.Mock).mockResolvedValueOnce(sentMsg);

    render(
      <MessageThread
        jobId={JOB_ID}
        currentUserAddress={USER_A}
        otherUserAddress={USER_B}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Recent message 2")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Type your message...");
    const sendButton = screen.getByRole("button", { name: /send/i });

    fireEvent.change(input, { target: { value: "Brand new message" } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText("Brand new message")).toBeInTheDocument();
    });

    expect(api.sendMessage).toHaveBeenCalledWith(JOB_ID, "Brand new message");
  });
});
