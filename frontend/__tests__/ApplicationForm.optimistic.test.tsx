import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import ApplicationForm from "@/components/ApplicationForm";
import * as api from "@/lib/api";
import type { Job } from "@/utils/types";

const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

jest.mock("@/components/Toast", () => ({
  useToast: () => mockToast,
}));

jest.mock("@/lib/api", () => ({
  submitApplication: jest.fn(),
  fetchProposalTemplates: jest.fn(),
  scoreProposal: jest.fn(),
}));

// Polyfill window.crypto.subtle for Jest jsdom environment if missing
if (!window.crypto) {
  (window as unknown as { crypto: unknown }).crypto = {};
}
if (!window.crypto.subtle) {
  (window.crypto as unknown as { subtle: unknown }).subtle = {
    digest: async (_algorithm: string, data: Uint8Array) => {
      // Simple mock sha256 output buffer
      return data.buffer;
    },
  };
}

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

describe("ApplicationForm optimistic updates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.fetchProposalTemplates as jest.Mock).mockResolvedValue([]);
  });

  it("Immediately after click: button text changes to 'Application submitted!' (optimistic) and button is disabled", async () => {
    let resolveSubmit: (val: any) => void = () => {};
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    (api.submitApplication as jest.Mock).mockReturnValue(submitPromise);

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );

    // Fill valid proposal
    const textarea = screen.getByLabelText("Cover Letter");
    fireEvent.change(textarea, { target: { value: LONG_PROPOSAL } });

    // Initial button state: enabled
    const button = screen.getByRole("button", { name: /Submit Proposal|Apply/i });
    expect(button).toBeEnabled();

    // Click submit
    fireEvent.click(button);

    // Immediately after click: text changes to "Application submitted!" and is disabled
    expect(button).toHaveTextContent("Application submitted!");
    expect(button).toBeDisabled();

    // Cleanup promise
    resolveSubmit({ success: true });
    await act(async () => {
      await submitPromise;
    });
  });

  it("On API error: revert button state and show an error toast", async () => {
    let rejectSubmit: (err: any) => void = () => {};
    const submitPromise = new Promise((_, reject) => {
      rejectSubmit = reject;
    });
    (api.submitApplication as jest.Mock).mockReturnValue(submitPromise);

    const onRevert = jest.fn();

    render(
      <ApplicationForm job={JOB} publicKey={USER} onRevert={onRevert} onSuccess={jest.fn()} />,
    );

    const textarea = screen.getByLabelText("Cover Letter");
    fireEvent.change(textarea, { target: { value: LONG_PROPOSAL } });

    const button = screen.getByRole("button", { name: /Submit Proposal|Apply/i });
    fireEvent.click(button);

    // Optimistically updated
    expect(button).toHaveTextContent("Application submitted!");
    expect(button).toBeDisabled();

    // Simulate API failure
    await act(async () => {
      rejectSubmit(new Error("Network Error"));
    });

    // Button state should be reverted: re-enabled and text restored
    await waitFor(() => {
      expect(button).not.toHaveTextContent("Application submitted!");
      expect(button).toHaveTextContent("Submit Proposal");
      expect(button).toBeEnabled();
    });

    // Error toast shown and onRevert called
    expect(mockToast.error).toHaveBeenCalledWith("Failed to submit application. Please try again.");
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it("On success: keep the optimistic state and disable the button permanently", async () => {
    let resolveSubmit: (val: any) => void = () => {};
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    (api.submitApplication as jest.Mock).mockReturnValue(submitPromise);

    const onSuccess = jest.fn();

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={onSuccess} />,
    );

    const textarea = screen.getByLabelText("Cover Letter");
    fireEvent.change(textarea, { target: { value: LONG_PROPOSAL } });

    const button = screen.getByRole("button", { name: /Submit Proposal|Apply/i });
    fireEvent.click(button);

    expect(button).toHaveTextContent("Application submitted!");
    expect(button).toBeDisabled();

    // Simulate API success
    await act(async () => {
      resolveSubmit({ success: true, data: { id: "app-1" } });
    });

    // Keeps optimistic state and remains disabled permanently
    expect(button).toHaveTextContent("Application submitted!");
    expect(button).toBeDisabled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("Prevents double submission when clicked multiple times while request is in flight", async () => {
    let resolveSubmit: (val: any) => void = () => {};
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    (api.submitApplication as jest.Mock).mockReturnValue(submitPromise);

    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );

    const textarea = screen.getByLabelText("Cover Letter");
    fireEvent.change(textarea, { target: { value: LONG_PROPOSAL } });

    const button = screen.getByRole("button", { name: /Submit Proposal|Apply/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(api.submitApplication).toHaveBeenCalledTimes(1));

    resolveSubmit({ success: true });
    await act(async () => {
      await submitPromise;
    });
  });
});
