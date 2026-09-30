import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SwapEarningsTab from "@/components/dashboard-tabs/SwapEarningsTab";
import * as api from "@/lib/api";
import * as stellar from "@/lib/stellar";

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  fetchSwapQuote: jest.fn(),
  createManualSwap: jest.fn(),
  completeAutoConversion: jest.fn(),
  dismissAutoConversion: jest.fn(),
  fetchAutoConvertHistory: jest.fn(),
}));

jest.mock("@/lib/stellar", () => ({
  executeAutoConvertSwap: jest.fn(),
}));

const USER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TX_HASH = "a".repeat(64);

const QUOTE = {
  sourceAmountXlm: "50.0000000",
  destinationAmount: "6.0000000",
  destMinUsdc: "5.9400000",
  rate: "0.1200000",
  feeXlm: "0.0000100",
  slippageBps: 100,
  path: [],
  usdcIssuer: USER,
};

function emptyHistory() {
  return {
    conversions: [],
    pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
  };
}

describe("SwapEarningsTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.fetchAutoConvertHistory as jest.Mock).mockResolvedValue(
      emptyHistory(),
    );
  });

  it("shows the live rate, estimated receive and fee for the entered amount", async () => {
    (api.fetchSwapQuote as jest.Mock).mockResolvedValue(QUOTE);

    render(
      <SwapEarningsTab publicKey={USER} xlmBalance="100" usdcBalance="5" />,
    );

    fireEvent.change(screen.getByLabelText(/amount to swap/i), {
      target: { value: "50" },
    });

    await waitFor(() => expect(api.fetchSwapQuote).toHaveBeenCalledWith("50"), {
      timeout: 3000,
    });

    expect(await screen.findByText(/1 XLM = 0\.1200 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/6\.0000 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/0\.00001 XLM/)).toBeInTheDocument();
    expect(screen.getByText(/5\.9400 USDC/)).toBeInTheDocument();
  });

  it("warns without blocking when the quote request fails", async () => {
    (api.fetchSwapQuote as jest.Mock).mockRejectedValue(
      new Error("horizon down"),
    );

    render(
      <SwapEarningsTab publicKey={USER} xlmBalance="100" usdcBalance="5" />,
    );

    fireEvent.change(screen.getByLabelText(/amount to swap/i), {
      target: { value: "50" },
    });

    expect(
      await screen.findByText(/could not fetch a swap quote right now/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /swap earnings to usdc/i }),
    ).toBeDisabled();
  });

  it("signs, records the swap and refreshes the payment history", async () => {
    (api.fetchSwapQuote as jest.Mock).mockResolvedValue(QUOTE);
    (api.createManualSwap as jest.Mock).mockResolvedValue({
      conversion: {
        id: "conv-9",
        destMinUsdc: "5.9400000",
        sourceAmountXlm: "50.0000000",
        status: "pending",
      },
      quote: QUOTE,
    });
    (stellar.executeAutoConvertSwap as jest.Mock).mockResolvedValue({
      hash: TX_HASH,
    });
    (api.completeAutoConversion as jest.Mock).mockResolvedValue({
      id: "conv-9",
      sourceAmountXlm: "50.0000000",
      receivedUsdc: "6.0000000",
      exchangeRate: "0.1200000",
      status: "completed",
    });

    render(
      <SwapEarningsTab publicKey={USER} xlmBalance="100" usdcBalance="5" />,
    );

    fireEvent.change(screen.getByLabelText(/amount to swap/i), {
      target: { value: "50" },
    });
    await screen.findByText(/1 XLM = 0\.1200 USDC/);

    fireEvent.click(
      screen.getByRole("button", { name: /swap earnings to usdc/i }),
    );

    await waitFor(() => {
      expect(api.createManualSwap).toHaveBeenCalledWith("50.0000000");
      expect(stellar.executeAutoConvertSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          fromPublicKey: USER,
          sourceAmountXlm: "50.0000000",
          destMinUsdc: "5.9400000",
        }),
      );
      expect(api.completeAutoConversion).toHaveBeenCalledWith(
        "conv-9",
        TX_HASH,
      );
    });

    // Payment history refetches after the confirmed swap.
    await waitFor(() =>
      expect(
        (api.fetchAutoConvertHistory as jest.Mock).mock.calls.length,
      ).toBeGreaterThan(1),
    );
  });
});
