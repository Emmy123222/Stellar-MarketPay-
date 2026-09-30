/**
 * Issue #1552 — Co-write proposal.
 *
 * Verifies the "Invite collaborator" button on ApplicationForm:
 *   1. creates a scope session and surfaces a shareable link, and
 *   2. locks that session when the proposal is submitted.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ApplicationForm from "@/components/ApplicationForm";
import * as api from "@/lib/api";
import { sampleJob, MOCK_PK_B } from "./helpers/fixtures";

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  submitApplication: jest.fn(),
  fetchProposalTemplates: jest.fn(),
  createScopeSession: jest.fn(),
  finalizeScopeSession: jest.fn(),
}));

const mockApi = api as jest.Mocked<typeof api>;

const WORDS_50 = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");

describe("ApplicationForm — co-write proposal (#1552)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.fetchProposalTemplates.mockResolvedValue([]);
    // jsdom has no WebCrypto subtle — the form hashes the bid commitment.
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: {
        ...window.crypto,
        getRandomValues: (arr: Uint8Array) => arr,
        subtle: { digest: jest.fn().mockResolvedValue(new ArrayBuffer(32)) },
      },
    });
  });

  it("creates a scope session and exposes a shareable invite link", async () => {
    mockApi.createScopeSession.mockResolvedValueOnce({
      sessionId: "sess-1552",
      sharePath: "/scope/sess-1552",
      expiresAt: "2026-09-24T00:00:00.000Z",
    });

    render(
      <ApplicationForm job={sampleJob} publicKey={MOCK_PK_B} onSuccess={jest.fn()} />,
    );

    const inviteButton = screen.getByTestId("invite-collaborator");
    expect(inviteButton).toHaveTextContent("Invite collaborator");

    fireEvent.click(inviteButton);

    await waitFor(() => expect(mockApi.createScopeSession).toHaveBeenCalledTimes(1));
    expect(mockApi.createScopeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: String(sampleJob.id),
        createdBy: MOCK_PK_B,
      }),
    );

    const link = await screen.findByLabelText("Co-writing invite link");
    expect(link).toHaveValue(`${window.location.origin}/scope/sess-1552`);
    expect(inviteButton).toHaveTextContent("Copy invite link");
  });

  it("locks the scope session when the proposal is submitted", async () => {
    mockApi.createScopeSession.mockResolvedValueOnce({
      sessionId: "sess-lock",
      sharePath: "/scope/sess-lock",
      expiresAt: "2026-09-24T00:00:00.000Z",
    });
    mockApi.submitApplication.mockResolvedValueOnce({} as never);
    mockApi.finalizeScopeSession.mockResolvedValueOnce({
      sessionId: "sess-lock",
      finalizedHash: "a".repeat(64),
      expiresAt: "2026-09-24T00:00:00.000Z",
    });

    const onSuccess = jest.fn();
    render(
      <ApplicationForm
        job={{ ...sampleJob, screeningQuestions: [] }}
        publicKey={MOCK_PK_B}
        prefillData={{ bidAmount: "100", message: WORDS_50 }}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(screen.getByTestId("invite-collaborator"));
    await screen.findByLabelText("Co-writing invite link");

    fireEvent.click(screen.getByRole("button", { name: /submit proposal/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm & submit/i }));

    await waitFor(() => expect(mockApi.submitApplication).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockApi.finalizeScopeSession).toHaveBeenCalledWith(
        "sess-lock",
        expect.objectContaining({
          content: WORDS_50,
          payload: expect.objectContaining({ jobId: String(sampleJob.id) }),
        }),
      ),
    );
    expect(onSuccess).toHaveBeenCalled();
  });
});
