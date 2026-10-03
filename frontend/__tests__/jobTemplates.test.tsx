import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PostJobForm from "@/components/PostJobForm";
import {
  createJob,
  updateJobEscrowId,
  getJwtToken,
  fetchJobTemplates,
  createJobTemplate,
} from "@/lib/api";
import { createEscrowOnChain } from "@/lib/stellar";
import "@testing-library/jest-dom";

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
  fetchSkillSuggestions: jest.fn().mockResolvedValue([]),
  fetchMyJobs: jest.fn().mockResolvedValue([]),
  fetchJobTemplates: jest.fn(),
  createJobTemplate: jest.fn(),
}));

jest.mock("@/lib/wallet", () => ({
  performSEP0010Auth: jest.fn().mockResolvedValue({ token: "mock-jwt" }),
}));

jest.mock("@/lib/stellar", () => ({
  createEscrowOnChain: jest.fn(),
}));

const MOCK_CLIENT_PK = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF";

describe("Job Template Library (Issue #1556)", () => {
  const mockTemplates = [
    {
      id: "tpl-1",
      clientId: MOCK_CLIENT_PK,
      name: "Monthly React Work",
      title: "Monthly React Component Maintenance",
      description: "Build and maintain recurring React UI components for platform.",
      category: "Frontend",
      budget: "250",
      currency: "XLM",
      skills: ["React", "TypeScript", "Tailwind"],
      milestones: [{ description: "Sprint 1", amount: "250" }],
      screeningQuestions: ["Link to your GitHub profile?"],
    },
    {
      id: "tpl-2",
      clientId: MOCK_CLIENT_PK,
      name: "Soroban Smart Contract Audit",
      title: "Soroban Smart Contract Security Audit",
      description: "Perform comprehensive security audit on Rust Soroban escrow contract.",
      category: "Smart Contracts",
      budget: "1000",
      currency: "XLM",
      skills: ["Rust", "Soroban", "Security"],
      milestones: [{ description: "Audit report", amount: "1000" }],
      screeningQuestions: ["Have you audited Soroban contracts before?"],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (getJwtToken as jest.Mock).mockReturnValue("mock-jwt");
    (createJob as jest.Mock).mockResolvedValue({ id: "job-101" });
    (createEscrowOnChain as jest.Mock).mockResolvedValue({ txHash: "mock-tx-hash-123" });
    (updateJobEscrowId as jest.Mock).mockResolvedValue({});
    (fetchJobTemplates as jest.Mock).mockResolvedValue(mockTemplates);
    (createJobTemplate as jest.Mock).mockResolvedValue({
      id: "tpl-new",
      clientId: MOCK_CLIENT_PK,
      name: "New Saved Template",
    });
  });

  it("fetches templates and pre-fills form fields when a template is selected", async () => {
    render(<PostJobForm publicKey={MOCK_CLIENT_PK} />);

    // Check template picker dropdown exists
    const picker = await screen.findByTestId("template-picker");
    expect(picker).toBeInTheDocument();

    // Verify template options are rendered
    await waitFor(() => {
      expect(screen.getByText("Monthly React Work")).toBeInTheDocument();
      expect(screen.getByText("Soroban Smart Contract Audit")).toBeInTheDocument();
    });

    // Select the first template
    fireEvent.change(picker, { target: { value: "tpl-1" } });

    // Verify fields were pre-filled
    const titleInput = screen.getByPlaceholderText("e.g. Build a Soroban DEX interface") as HTMLInputElement;
    const descInput = screen.getByPlaceholderText("Describe the work, deliverables, and any context...") as HTMLTextAreaElement;

    expect(titleInput.value).toBe("Monthly React Component Maintenance");
    expect(descInput.value).toBe("Build and maintain recurring React UI components for platform.");
    expect(screen.getByText('Loaded details from template "Monthly React Work"')).toBeInTheDocument();
  });

  it("shows 'Save as template' button on the job posting confirmation page and allows saving", async () => {
    render(<PostJobForm publicKey={MOCK_CLIENT_PK} />);

    // Step 1: Fill Basic Info
    const titleInput = screen.getByPlaceholderText("e.g. Build a Soroban DEX interface");
    const descInput = screen.getByPlaceholderText("Describe the work, deliverables, and any context...");
    fireEvent.change(titleInput, { target: { value: "Full Stack Soroban Marketplace" } });
    fireEvent.change(descInput, { target: { value: "Building end-to-end Soroban marketplace with decentralized escrow." } });

    fireEvent.click(screen.getByRole("button", { name: "Next →" }));

    // Step 2: Budget
    await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));

    // Step 3: Requirements
    await waitFor(() => expect(screen.getByText("Step 3 of 4")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));

    // Step 4: Review
    await waitFor(() => expect(screen.getByText("Step 4 of 4")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Publish Job" }));

    // Confirmation page reached
    await waitFor(() => {
      expect(screen.getByText("Job Posted!")).toBeInTheDocument();
    });

    // "Save as template" button is visible on confirmation screen
    const saveAsTemplateBtn = screen.getByRole("button", { name: /Save as template/i });
    expect(saveAsTemplateBtn).toBeInTheDocument();

    // Click Save as template
    fireEvent.click(saveAsTemplateBtn);

    // Template name input appears
    const nameInput = screen.getByLabelText(/Template Name/i);
    expect(nameInput).toBeInTheDocument();

    // Submit save
    const saveBtn = screen.getByRole("button", { name: "Save Template" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createJobTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Full Stack Soroban Marketplace",
          clientId: MOCK_CLIENT_PK,
        })
      );
      expect(screen.getByText("Saved as template!")).toBeInTheDocument();
    });
  });
});
