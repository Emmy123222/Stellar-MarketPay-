import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PostJobForm from "@/components/PostJobForm";
import { createJob, updateJobEscrowId, getJwtToken } from "@/lib/api";
import { createEscrowOnChain } from "@/lib/stellar";
import "@testing-library/jest-dom";

// Mock the required modules
jest.mock("@/contexts/PriceContext", () => ({
  usePriceContext: () => ({
    xlmPriceUsd: 0.12,
    priceLoading: false,
    currencyMode: "XLM",
    setCurrencyMode: jest.fn(),
  }),
  PriceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/lib/api", () => ({
  createJob: jest.fn(),
  updateJobEscrowId: jest.fn(),
  deleteJob: jest.fn(),
  saveDraft: jest.fn().mockResolvedValue({ id: "draft-123" }),
  updateDraft: jest.fn().mockResolvedValue({ id: "draft-123" }),
  getJwtToken: jest.fn(),
  fetchCategories: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/wallet", () => ({
  performSEP0010Auth: jest.fn().mockResolvedValue({ token: "mock-jwt" }),
}));

jest.mock("@/lib/stellar", () => ({
  createEscrowOnChain: jest.fn(),
}));

const MOCK_PK = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("PostJobForm reset behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (getJwtToken as jest.Mock).mockReturnValue("mock-jwt");
    (createJob as jest.Mock).mockResolvedValue({ id: "job-123" });
    (createEscrowOnChain as jest.Mock).mockResolvedValue({ txHash: "mock-tx-hash" });
    (updateJobEscrowId as jest.Mock).mockResolvedValue({});
  });

  it("resets form and clears all step states in the multi-step form on successful job creation", async () => {
    render(<PostJobForm publicKey={MOCK_PK} />);

    // --- STEP 1: Basic Info ---
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();

    // Fill title and description
    const titleInput = screen.getByPlaceholderText("e.g. Build a Soroban DEX interface");
    const descInput = screen.getByPlaceholderText("Describe the work, deliverables, and any context...");

    fireEvent.change(titleInput, { target: { value: "Soroban DEX Interface Implementation" } });
    fireEvent.change(descInput, { target: { value: "This is a detailed description of the Soroban DEX interface that satisfies the 30 characters limit." } });

    // Click Next
    const nextBtn1 = screen.getByRole("button", { name: "Next →" });
    fireEvent.click(nextBtn1);

    // --- STEP 2: Budget & Escrow ---
    await waitFor(() => {
      expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    });

    // Default values are valid, so click Next
    const nextBtn2 = screen.getByRole("button", { name: "Next →" });
    fireEvent.click(nextBtn2);

    // --- STEP 3: Requirements ---
    await waitFor(() => {
      expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    });

    const nextBtn3 = screen.getByRole("button", { name: "Next →" });
    fireEvent.click(nextBtn3);

    // --- STEP 4: Review & Publish ---
    await waitFor(() => {
      expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    });

    // Click Publish Job
    const publishBtn = screen.getByRole("button", { name: "Publish Job" });
    fireEvent.click(publishBtn);

    // Verify completion
    await waitFor(() => {
      expect(screen.getByText("Job Posted!")).toBeInTheDocument();
    });

    // Verify localStorage draft is cleared
    expect(localStorage.getItem("marketpay_post_job_draft")).toBeNull();

    // Now let's click "Post Another Job" to go back to the form and verify that everything was cleared/reset
    const postAnotherBtn = screen.getByRole("button", { name: "Post Another Job" });
    fireEvent.click(postAnotherBtn);

    // Verify we are back to Step 1
    await waitFor(() => {
      expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    });

    // Verify that the title and description fields are completely empty (reset)
    const resetTitleInput = screen.getByPlaceholderText("e.g. Build a Soroban DEX interface") as HTMLInputElement;
    const resetDescInput = screen.getByPlaceholderText("Describe the work, deliverables, and any context...") as HTMLTextAreaElement;

    expect(resetTitleInput.value).toBe("");
    expect(resetDescInput.value).toBe("");
  });
});
