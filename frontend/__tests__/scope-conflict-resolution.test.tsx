import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import ScopeSessionPage from "@/pages/scope/[sessionId]";
import { ToastProvider } from "@/components/Toast";
import "@testing-library/jest-dom";

// Mock next/router
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({
    isReady: true,
    query: { sessionId: "test-session-123" },
    replace: mockReplace,
    push: mockPush,
  }),
}));

// Mock renewScopeSession and saveScopeSession
jest.mock("@/lib/api/scope", () => {
  const actual = jest.requireActual("@/lib/api/scope");
  return {
    ...actual,
    renewScopeSession: jest.fn().mockResolvedValue({
      sessionId: "test-session-123",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }),
    saveScopeSession: jest.fn().mockImplementation((sessionId, payload) =>
      Promise.resolve({
        session_id: sessionId,
        content: payload.content || "",
        cursors: payload.cursors || {},
        finalized: false,
        finalized_hash: null,
        finalized_payload: null,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ),
  };
});

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = WebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = jest.fn();
  close = jest.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 0);
  }
}

(global as any).WebSocket = MockWebSocket;

describe("Scope Collaboration & Conflict Resolution (Issue #1417)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockWebSocket.instances = [];
  });

  it("renders remote collaborator cursors received via WebSocket and filters out own cursor", async () => {
    render(
      <ToastProvider>
        <ScopeSessionPage />
      </ToastProvider>,
    );

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();

    // 1. Send scope:init
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:init",
          payload: {
            sessionId: "test-session-123",
            participantId: "user-me",
            content: "Initial scope document text",
            cursors: {},
            updatedAt: "2026-09-27T08:00:00Z",
            version: 1,
          },
        }),
      });
    });

    const textarea = screen.getByTestId(
      "scope-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Initial scope document text");

    // 2. Receive scope:update with remote cursor data
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:update",
          payload: {
            sessionId: "test-session-123",
            content: "Initial scope document text",
            cursors: {
              "user-me": { start: 0, end: 0, updatedAt: 100 },
              "collaborator-bob": { start: 12, end: 12, updatedAt: 100 },
            },
            updatedAt: "2026-09-27T08:01:00Z",
            version: 2,
          },
        }),
      });
    });

    // Remote cursor for collaborator-bob should be displayed
    expect(
      screen.getByTestId("remote-cursor-collaborator-bob"),
    ).toBeInTheDocument();
    expect(screen.getByText("collabor")).toBeInTheDocument();

    // Own cursor user-me should NOT be rendered
    expect(
      screen.queryByTestId("remote-cursor-user-me"),
    ).not.toBeInTheDocument();
  });

  it("triggers conflict toast and warning banner when server version diverged from local dirty edits", async () => {
    render(
      <ToastProvider>
        <ScopeSessionPage />
      </ToastProvider>,
    );

    const ws = MockWebSocket.instances[0];

    // 1. Init session
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:init",
          payload: {
            sessionId: "test-session-123",
            participantId: "user-me",
            content: "Base content",
            cursors: {},
            updatedAt: "2026-09-27T08:00:00Z",
            version: 1,
          },
        }),
      });
    });

    const textarea = screen.getByTestId(
      "scope-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Base content");

    // 2. User types local changes (dirtying editor)
    fireEvent.change(textarea, {
      target: { value: "Base content with local unsaved edits" },
    });
    expect(textarea.value).toBe("Base content with local unsaved edits");

    // 3. Remote user submits an update to the server (conflict scenario)
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:update",
          payload: {
            sessionId: "test-session-123",
            content: "Server conflicting changes made by someone else",
            cursors: {
              "collaborator-bob": { start: 5, end: 10, updatedAt: 200 },
            },
            updatedAt: "2026-09-27T08:05:00Z",
            version: 2,
          },
        }),
      });
    });

    // Verify: Conflict warning banner is displayed above editor
    const banner = screen.getByTestId("conflict-warning-banner");
    expect(banner).toBeInTheDocument();
    expect(
      within(banner).getByText(
        "Conflict detected — your changes may have been overwritten",
      ),
    ).toBeInTheDocument();

    // Verify: Toast notification is rendered
    const toastElements = screen.getAllByText(
      "Conflict detected — your changes may have been overwritten",
    );
    expect(toastElements.length).toBeGreaterThanOrEqual(1);

    // Verify: User's local edits are preserved until decision
    expect(textarea.value).toBe("Base content with local unsaved edits");

    // 4. Test "Reload latest server content" button
    const reloadBtn = screen.getByTestId("conflict-reload-btn");
    fireEvent.click(reloadBtn);

    // Verify: Banner is dismissed and content reloads to server version
    expect(
      screen.queryByTestId("conflict-warning-banner"),
    ).not.toBeInTheDocument();
    expect(textarea.value).toBe(
      "Server conflicting changes made by someone else",
    );
  });

  it("dismisses conflict banner when user clicks Dismiss", async () => {
    render(
      <ToastProvider>
        <ScopeSessionPage />
      </ToastProvider>,
    );

    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:init",
          payload: {
            sessionId: "test-session-123",
            participantId: "user-me",
            content: "Base text",
            cursors: {},
            updatedAt: "2026-09-27T08:00:00Z",
            version: 1,
          },
        }),
      });
    });

    const textarea = screen.getByTestId(
      "scope-textarea",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "My private notes added" } });

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:update",
          payload: {
            sessionId: "test-session-123",
            content: "Remote changes",
            cursors: {},
            updatedAt: "2026-09-27T08:05:00Z",
            version: 2,
          },
        }),
      });
    });

    expect(screen.getByTestId("conflict-warning-banner")).toBeInTheDocument();

    // Click Dismiss
    const dismissBtn = screen.getByTestId("conflict-dismiss-btn");
    fireEvent.click(dismissBtn);

    // Verify banner is closed and local text kept
    expect(
      screen.queryByTestId("conflict-warning-banner"),
    ).not.toBeInTheDocument();
    expect(textarea.value).toBe("My private notes added");
  });

  it("updates text smoothly without conflict warning when local is not dirty", async () => {
    render(
      <ToastProvider>
        <ScopeSessionPage />
      </ToastProvider>,
    );

    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:init",
          payload: {
            sessionId: "test-session-123",
            participantId: "user-me",
            content: "Initial text",
            cursors: {},
            updatedAt: "2026-09-27T08:00:00Z",
            version: 1,
          },
        }),
      });
    });

    const textarea = screen.getByTestId(
      "scope-textarea",
    ) as HTMLTextAreaElement;

    // Remote update arrives when user hasn't edited anything
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          event: "scope:update",
          payload: {
            sessionId: "test-session-123",
            content: "Updated text from collaborator",
            cursors: {},
            updatedAt: "2026-09-27T08:02:00Z",
            version: 2,
          },
        }),
      });
    });

    expect(
      screen.queryByTestId("conflict-warning-banner"),
    ).not.toBeInTheDocument();
    expect(textarea.value).toBe("Updated text from collaborator");
  });
});
