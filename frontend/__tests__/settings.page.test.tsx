import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SettingsPage from "@/pages/settings";
import * as api from "@/lib/api";
import * as stellar from "@/lib/stellar";

jest.mock("next/router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    pathname: "/settings",
    query: {},
  }),
}));

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  fetchAutoConvertSettings: jest.fn(),
  updateAutoConvertSettings: jest.fn(),
  fetchPendingAutoConversions: jest.fn(),
  completeAutoConversion: jest.fn(),
  dismissAutoConversion: jest.fn(),
  fetchAutoConvertHistory: jest.fn(),
}));

jest.mock("@/lib/stellar", () => ({
  executeAutoConvertSwap: jest.fn(),
  accountUrl: jest.fn((addr) => `https://stellar.expert/address/${addr}`),
}));

describe("SettingsPage", () => {
  const dummyUser = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows connect wallet state when user is not connected", () => {
    render(<SettingsPage publicKey={null} onConnect={jest.fn()} />);
    expect(screen.getByText("Connect Your Wallet")).toBeInTheDocument();
  });

  it("loads and displays auto-convert toggle, pending swaps, and history", async () => {
    (api.fetchAutoConvertSettings as jest.Mock).mockResolvedValueOnce({
      enabled: true,
      slippageBps: 100,
      usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });

    (api.fetchPendingAutoConversions as jest.Mock).mockResolvedValueOnce([
      {
        id: "conv-1",
        userAddress: dummyUser,
        jobId: "job-1",
        jobTitle: "Landing Page Redesign",
        milestoneIndex: null,
        sourceAmountXlm: "50.0000000",
        quotedUsdc: "5.5000000",
        destMinUsdc: "5.4450000",
        receivedUsdc: null,
        exchangeRate: null,
        txHash: null,
        status: "pending",
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    ]);

    (api.fetchAutoConvertHistory as jest.Mock).mockResolvedValueOnce({
      conversions: [
        {
          id: "conv-0",
          userAddress: dummyUser,
          jobId: "job-0",
          jobTitle: "Brand Identity",
          milestoneIndex: null,
          sourceAmountXlm: "100.0000000",
          quotedUsdc: "11.0000000",
          destMinUsdc: "10.8900000",
          receivedUsdc: "11.0500000",
          exchangeRate: "0.1105000",
          txHash:
            "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
          status: "completed",
          error: null,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ],
      pagination: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
    });

    render(<SettingsPage publicKey={dummyUser} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(api.fetchAutoConvertSettings).toHaveBeenCalled();
      expect(api.fetchPendingAutoConversions).toHaveBeenCalled();
      expect(api.fetchAutoConvertHistory).toHaveBeenCalled();
    });

    expect(
      screen.getByText("Auto-Convert Earnings to USDC"),
    ).toBeInTheDocument();
    expect(screen.getByText("Landing Page Redesign")).toBeInTheDocument();
    expect(screen.getByText("Convert to USDC")).toBeInTheDocument();
    expect(screen.getByText("Brand Identity")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("handles swap execution when clicking Convert to USDC", async () => {
    (api.fetchAutoConvertSettings as jest.Mock).mockResolvedValueOnce({
      enabled: true,
      slippageBps: 100,
      usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });

    const pendingItem = {
      id: "conv-1",
      userAddress: dummyUser,
      jobId: "job-1",
      jobTitle: "Landing Page Redesign",
      milestoneIndex: null,
      sourceAmountXlm: "50.0000000",
      quotedUsdc: "5.5000000",
      destMinUsdc: "5.4450000",
      receivedUsdc: null,
      exchangeRate: null,
      txHash: null,
      status: "pending",
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    (api.fetchPendingAutoConversions as jest.Mock).mockResolvedValueOnce([
      pendingItem,
    ]);
    (api.fetchAutoConvertHistory as jest.Mock).mockResolvedValueOnce({
      conversions: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
    });

    (stellar.executeAutoConvertSwap as jest.Mock).mockResolvedValueOnce({
      hash: "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
    });

    (api.completeAutoConversion as jest.Mock).mockResolvedValueOnce({
      ...pendingItem,
      status: "completed",
      receivedUsdc: "5.5000000",
      exchangeRate: "0.1100000",
    });

    render(<SettingsPage publicKey={dummyUser} onConnect={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Convert to USDC")).toBeInTheDocument();
    });

    const convertBtn = screen.getByText("Convert to USDC");
    fireEvent.click(convertBtn);

    await waitFor(() => {
      expect(stellar.executeAutoConvertSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          fromPublicKey: dummyUser,
          sourceAmountXlm: "50.0000000",
          destMinUsdc: "5.4450000",
        }),
      );
      expect(api.completeAutoConversion).toHaveBeenCalledWith(
        "conv-1",
        "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
      );
    });
  });
});
