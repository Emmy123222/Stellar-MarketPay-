import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommandPalette from "@/components/CommandPalette";
import * as api from "@/lib/api";

jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  searchUnified: jest.fn(),
}));

describe("CommandPalette with Unified Search", () => {
  const mockSearchUnified = api.searchUnified as jest.MockedFunction<
    typeof api.searchUnified
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders command palette and pages when open", () => {
    render(<CommandPalette isOpen={true} onClose={jest.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/search pages, jobs, freelancers, or dao proposals/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Browse Jobs")).toBeInTheDocument();
  });

  it("calls searchUnified and renders jobs, freelancers, and proposals with entity badges", async () => {
    mockSearchUnified.mockResolvedValueOnce({
      jobs: [
        {
          id: "job-101",
          title: "Rust Soroban Engineer",
          description: "Smart contract work",
          budget: "2500",
          currency: "USDC",
          category: "Smart Contracts",
          status: "open",
          rank: 0.9,
        },
      ],
      freelancers: [
        {
          publicKey: "GABCD1234",
          displayName: "Bob Builder",
          bio: "Stellar dev",
          skills: ["Rust", "Soroban"],
          completedJobs: 5,
          role: "freelancer",
          rank: 0.8,
        },
      ],
      proposals: [
        {
          id: "prop-202",
          title: "Add Liquidity Pool Support",
          description: "DAO treasury grant",
          type: "treasury",
          proposer: "GPROP999",
          status: "active",
          rank: 0.75,
        },
      ],
    });

    render(<CommandPalette isOpen={true} onClose={jest.fn()} />);
    const input = screen.getByPlaceholderText(/search pages, jobs, freelancers, or dao proposals/i);

    await userEvent.type(input, "soroban");

    await waitFor(() => {
      expect(mockSearchUnified).toHaveBeenCalledWith("soroban", 5);
    });

    // Check entity type badges rendered
    await waitFor(() => {
      expect(screen.getByText("Rust Soroban Engineer")).toBeInTheDocument();
      expect(screen.getByText("Bob Builder")).toBeInTheDocument();
      expect(screen.getByText("Add Liquidity Pool Support")).toBeInTheDocument();

      expect(screen.getByText("Job")).toBeInTheDocument();
      expect(screen.getByText("Freelancer")).toBeInTheDocument();
      expect(screen.getByText("Proposal")).toBeInTheDocument();
    });
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <CommandPalette isOpen={false} onClose={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
