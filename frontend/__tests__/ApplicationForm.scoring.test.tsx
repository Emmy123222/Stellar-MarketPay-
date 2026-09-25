import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ApplicationForm from "@/components/ApplicationForm";
import * as api from "@/lib/api";
import type { Job } from "@/utils/types";

const mockToastError = jest.fn();

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: mockToastError,
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  submitApplication: jest.fn(),
  fetchProposalTemplates: jest.fn(),
  scoreProposal: jest.fn(),
}));

const USER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const JOB = {
  id: "job-1",
  title: "Soroban escrow contract",
  description: "Build a milestone-based escrow contract.",
  budget: "100",
  currency: "XLM",
  skills: ["Rust", "Soroban"],
} as unknown as Job;

const LONG_PROPOSAL =
  Array.from({ length: 55 }, (_, i) => `word${i}`).join(" ") +
  " with Soroban escrow experience.";

describe("ApplicationForm proposal scoring (#1548)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (api.fetchProposalTemplates as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("debounces scoring by 2s and shows relevance, clarity and completeness", async () => {
    (api.scoreProposal as jest.Mock).mockResolvedValue({
      data: {
        relevance: 88,
        clarity: 72,
        completeness: 65,
        overall: 75,
        suggestions: ["Add a delivery timeline"],
      },
      warning: null,
    });

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );
    const textarea = screen.getByLabelText("Cover Letter");

    // Two quick edits — only the last one should be scored.
    fireEvent.change(textarea, { target: { value: LONG_PROPOSAL } });
    fireEvent.change(textarea, { target: { value: `${LONG_PROPOSAL} more` } });

    expect(api.scoreProposal).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(api.scoreProposal).toHaveBeenCalledTimes(1);
    expect(api.scoreProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal: `${LONG_PROPOSAL} more`,
        jobTitle: JOB.title,
        jobDescription: JOB.description,
        skills: ["Rust", "Soroban"],
      }),
    );

    expect(await screen.findByText("Relevance")).toBeInTheDocument();
    expect(screen.getByText("Overall 75/100")).toBeInTheDocument();
    expect(screen.getByText("Add a delivery timeline")).toBeInTheDocument();
  });

  it("treats an AI failure as a non-blocking warning", async () => {
    (api.scoreProposal as jest.Mock).mockRejectedValue(new Error("ai down"));

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Cover Letter"), {
      target: { value: LONG_PROPOSAL },
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(
      await screen.findByText(/Proposal scoring is unavailable/i),
    ).toBeInTheDocument();
    // Scoring failure must never block submission.
    expect(
      screen.getByRole("button", { name: /Submit Proposal/i }),
    ).toBeEnabled();
  });

  it("does not call the AI for very short drafts", async () => {
    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Cover Letter"), {
      target: { value: "too short" },
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(api.scoreProposal).not.toHaveBeenCalled();
  });

  it("shows the submitted state while the application request is pending", async () => {
    (window.crypto.subtle.digest as jest.Mock) = jest.fn().mockResolvedValue(new ArrayBuffer(32));
    (api.submitApplication as jest.Mock).mockReturnValue(new Promise(() => {}));

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Cover Letter"), {
      target: { value: LONG_PROPOSAL },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Proposal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Submit" }));

    expect(await screen.findByRole("button", { name: "Application submitted!" })).toBeDisabled();
  });

  it("reverts the submitted state and shows an error when submission fails", async () => {
    (window.crypto.subtle.digest as jest.Mock) = jest.fn().mockResolvedValue(new ArrayBuffer(32));
    (api.submitApplication as jest.Mock).mockRejectedValue(new Error("request failed"));

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Cover Letter"), {
      target: { value: LONG_PROPOSAL },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Proposal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Submit" }));

    expect(await screen.findByRole("button", { name: "Submit Proposal" })).toBeEnabled();
    expect(mockToastError).toHaveBeenCalledWith("Failed to submit application. Please try again.");
  });

  it("keeps the submitted state after a successful application request", async () => {
    (window.crypto.subtle.digest as jest.Mock) = jest.fn().mockResolvedValue(new ArrayBuffer(32));
    (api.submitApplication as jest.Mock).mockResolvedValue({ id: "application-1" });

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Cover Letter"), {
      target: { value: LONG_PROPOSAL },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Proposal" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Submit" }));

    expect(await screen.findByRole("button", { name: "Application submitted!" })).toBeDisabled();
    expect(api.submitApplication).toHaveBeenCalledTimes(1);
  });
});
