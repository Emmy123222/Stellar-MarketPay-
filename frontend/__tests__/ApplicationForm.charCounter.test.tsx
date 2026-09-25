/**
 * __tests__/ApplicationForm.charCounter.test.tsx
 *
 * Issue #2xxx — the proposal textarea must show a live character counter
 * (e.g. "234 / 2000"), turn red when fewer than 100 characters remain, and
 * enforce maxLength so writers can't type past the backend limit.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ApplicationForm, {
  MAX_PROPOSAL_CHARS,
} from "@/components/ApplicationForm";
import * as api from "@/lib/api";
import type { Job } from "@/utils/types";

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

describe("ApplicationForm proposal character counter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.fetchProposalTemplates as jest.Mock).mockResolvedValue([]);
  });

  it("renders the counter as `0 / 2000` on mount", () => {
    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );

    expect(screen.getByTestId("proposal-char-count")).toHaveTextContent(
      `0 / ${MAX_PROPOSAL_CHARS}`,
    );
  });

  it("updates the count as the user types", () => {
    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );

    const proposal = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    fireEvent.change(screen.getByLabelText("Cover Letter"), {
      target: { value: proposal },
    });

    expect(screen.getByTestId("proposal-char-count")).toHaveTextContent(
      `${proposal.length} / ${MAX_PROPOSAL_CHARS}`,
    );
  });

  it("stays amber while more than 100 characters remain", () => {
    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );

    const textarea = screen.getByLabelText("Cover Letter");
    fireEvent.change(textarea, {
      target: { value: "a".repeat(MAX_PROPOSAL_CHARS - 100) },
    });

    expect(screen.getByTestId("proposal-char-count")).toHaveClass(
      "text-amber-700",
    );
    expect(screen.getByTestId("proposal-char-count")).not.toHaveClass(
      "text-red-400",
    );
  });

  it("turns red when fewer than 100 characters remain", () => {
    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );

    const textarea = screen.getByLabelText("Cover Letter");
    // 100 remaining → not red yet; 99 remaining → red.
    fireEvent.change(textarea, {
      target: { value: "a".repeat(MAX_PROPOSAL_CHARS - 100) },
    });
    expect(screen.getByTestId("proposal-char-count")).not.toHaveClass(
      "text-red-400",
    );

    fireEvent.change(textarea, {
      target: { value: "a".repeat(MAX_PROPOSAL_CHARS - 99) },
    });
    expect(screen.getByTestId("proposal-char-count")).toHaveClass(
      "text-red-400",
    );
  });

  it("sets maxLength on the textarea so typing stops at the limit", () => {
    render(
      <ApplicationForm job={JOB} publicKey={USER} onSuccess={jest.fn()} />,
    );

    const textarea = screen.getByLabelText(
      "Cover Letter",
    ) as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(MAX_PROPOSAL_CHARS);
  });
});
