import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BoostJobModal from "../components/BoostJobModal";
import * as stellarLib from "../lib/stellar";

let mockXlmPriceUsd: number | null = 0.12;

jest.mock("@/contexts/PriceContext", () => ({
  usePriceContext: () => ({
    xlmPriceUsd: mockXlmPriceUsd,
    priceLoading: false,
    currencyMode: "XLM",
    setCurrencyMode: jest.fn(),
  }),
  PriceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the stellar library
jest.mock("../lib/stellar", () => ({
  buildBoostJobTx: jest.fn(),
  signAndSubmitSorobanTx: jest.fn(),
  XLM_SAC_ADDRESS: "test-sac-address",
}));

describe("BoostJobModal", () => {
  const mockOnClose = jest.fn();
  const mockOnSuccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockXlmPriceUsd = 0.12;
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    ) as jest.Mock;
  });

  it("renders the modal and shows the correct job title", () => {
    render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job Title"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );
    expect(screen.getByText("Boost Job Listing")).toBeInTheDocument();
    expect(screen.getByText("Test Job Title")).toBeInTheDocument();
  });

  it("calls onClose when the cancel button is clicked", () => {
    render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("handles the boost process correctly in mock mode", async () => {
    process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK = "true";

    render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Click 7-Day Boost button
    fireEvent.click(screen.getByText("7-Day Boost"));

    // Click Pay & Boost
    fireEvent.click(screen.getByText(/Pay 5 XLM & Boost/i));

    // Loading state check
    expect(screen.getByText("Building transaction…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Boost activated!")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/jobs/job-1/boost", expect.objectContaining({
      method: "PATCH"
    }));
    expect(mockOnSuccess).toHaveBeenCalled();
  });

  it("handles the boost process with a real transaction", async () => {
    process.env.NEXT_PUBLIC_USE_CONTRACT_MOCK = "false";
    (stellarLib.buildBoostJobTx as jest.Mock).mockResolvedValue("mocked-xdr");
    (stellarLib.signAndSubmitSorobanTx as jest.Mock).mockResolvedValue("mocked-hash");

    render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Select 30-Day Boost
    fireEvent.click(screen.getByText("30-Day Boost"));
    fireEvent.click(screen.getByText(/Pay 15 XLM & Boost/i));

    await waitFor(() => {
      expect(stellarLib.buildBoostJobTx).toHaveBeenCalledWith(expect.objectContaining({
        jobId: "job-1",
        amountXlm: 15,
      }));
    });

    expect(stellarLib.signAndSubmitSorobanTx).toHaveBeenCalledWith("mocked-xdr");

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/jobs/job-1/boost", expect.objectContaining({
        method: "PATCH"
      }));
    });
    
    expect(mockOnSuccess).toHaveBeenCalled();
  });

  it("displays boost price in XLM and estimated USD equivalent with ~ prefix", () => {
    mockXlmPriceUsd = 0.12;
    render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // 5 XLM * $0.12 = $0.60 -> 5 XLM (~$0.60)
    expect(screen.getByText("5 XLM")).toBeInTheDocument();
    expect(screen.getByText("(~$0.60)")).toBeInTheDocument();

    // 15 XLM * $0.12 = $1.80 -> 15 XLM (~$1.80)
    expect(screen.getByText("15 XLM")).toBeInTheDocument();
    expect(screen.getByText("(~$1.80)")).toBeInTheDocument();
  });

  it("updates the displayed USD equivalent in real time when xlm price changes", () => {
    mockXlmPriceUsd = 0.12;
    const { rerender } = render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText("(~$0.60)")).toBeInTheDocument();
    expect(screen.getByText("(~$1.80)")).toBeInTheDocument();

    // Change price: 5 XLM * $0.20 = $1.00, 15 XLM * $0.20 = $3.00
    mockXlmPriceUsd = 0.20;
    rerender(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText("(~$1.00)")).toBeInTheDocument();
    expect(screen.getByText("(~$3.00)")).toBeInTheDocument();
  });

  it("displays only XLM when xlmPriceUsd is unavailable (null)", () => {
    mockXlmPriceUsd = null;
    render(
      <BoostJobModal
        jobId="job-1"
        jobTitle="Test Job"
        clientPublicKey="GCLIENT..."
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText("5 XLM")).toBeInTheDocument();
    expect(screen.getByText("15 XLM")).toBeInTheDocument();
    expect(screen.queryByText(/\(~\$/)).not.toBeInTheDocument();
  });
});

