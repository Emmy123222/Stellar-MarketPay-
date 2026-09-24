/**
 * __tests__/BuyXLMModal.test.tsx
 * Tests for BuyXLMModal — Freighter on-ramp integration + SEP-0024 fallback.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import BuyXLMModal from "../components/BuyXLMModal";
import * as walletLib from "../lib/wallet";
import * as anchorsLib from "../lib/anchors";

// ── Shared mocks ──────────────────────────────────────────────────────────────

jest.mock("../lib/wallet", () => ({
  supportsRequestBuy: jest.fn(),
  freighterRequestBuy: jest.fn(),
}));

jest.mock("../lib/anchors", () => ({
  ANCHOR_HOME_DOMAIN: "anchor.example.com",
  fetchAnchorEndpoints: jest.fn(),
  startInteractiveDeposit: jest.fn(),
  pollAnchorTransaction: jest.fn(),
}));

jest.mock("../contexts/PriceContext", () => ({
  usePriceContext: () => ({ xlmPriceUsd: 0.12 }),
}));

jest.mock("../components/Toast", () => ({
  useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }),
}));

const MOCK_PK = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const noop = jest.fn();

function mockAnchorEndpoints() {
  (anchorsLib.fetchAnchorEndpoints as jest.Mock).mockResolvedValue({
    currencies: [{ code: "XLM" }],
    TRANSFER_SERVER: "https://anchor.example.com/transfer",
    WEB_AUTH_ENDPOINT: "https://anchor.example.com/auth",
    KYC_SERVER: "https://anchor.example.com/kyc",
  });
}

// ── Freighter on-ramp path ────────────────────────────────────────────────────

describe("BuyXLMModal — Freighter on-ramp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnchorEndpoints();
  });

  it("shows the Freighter on-ramp button when requestBuy() is supported", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockResolvedValue(true);
    (walletLib.freighterRequestBuy as jest.Mock).mockResolvedValue(undefined);

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />);

    await waitFor(() => {
      expect(screen.getByTestId("freighter-onramp-btn")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("anchor-deposit-btn")).not.toBeInTheDocument();
  });

  it("calls freighterRequestBuy('XLM') when the Freighter on-ramp button is clicked", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockResolvedValue(true);
    (walletLib.freighterRequestBuy as jest.Mock).mockResolvedValue(undefined);

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} onComplete={noop} />);

    await waitFor(() => screen.getByTestId("freighter-onramp-btn"));
    fireEvent.click(screen.getByTestId("freighter-onramp-btn"));

    expect(screen.getByTestId("loading-msg")).toBeInTheDocument();

    await waitFor(() => {
      expect(walletLib.freighterRequestBuy).toHaveBeenCalledWith("XLM");
      expect(screen.getByTestId("completed-msg")).toBeInTheDocument();
    });
    expect(noop).toHaveBeenCalled(); // onComplete
  });

  it("returns to idle when the user cancels the Freighter on-ramp", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockResolvedValue(true);
    (walletLib.freighterRequestBuy as jest.Mock).mockRejectedValue(
      new Error("User declined to complete the purchase.")
    );

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />);

    await waitFor(() => screen.getByTestId("freighter-onramp-btn"));
    fireEvent.click(screen.getByTestId("freighter-onramp-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("freighter-onramp-btn")).toBeInTheDocument();
    });
    // Should not show error — user cancel is a silent dismissal
    expect(screen.queryByTestId("error-msg")).not.toBeInTheDocument();
  });

  it("shows an error when freighterRequestBuy() throws a non-cancel error", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockResolvedValue(true);
    (walletLib.freighterRequestBuy as jest.Mock).mockRejectedValue(
      new Error("Network failure")
    );

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />);

    await waitFor(() => screen.getByTestId("freighter-onramp-btn"));
    fireEvent.click(screen.getByTestId("freighter-onramp-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("error-msg")).toBeInTheDocument();
      expect(screen.getByTestId("error-msg")).toHaveTextContent("Network failure");
    });
  });

  it("allows falling back to the anchor flow via 'Use exchange list instead'", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockResolvedValue(true);

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />);

    await waitFor(() => screen.getByTestId("freighter-onramp-btn"));
    fireEvent.click(screen.getByTestId("use-anchor-fallback-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("anchor-deposit-btn")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("freighter-onramp-btn")).not.toBeInTheDocument();
  });
});

// ── Fallback path ─────────────────────────────────────────────────────────────

describe("BuyXLMModal — SEP-0024 anchor fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnchorEndpoints();
  });

  it("shows the anchor deposit button when Freighter version is insufficient", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockResolvedValue(false);

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />);

    await waitFor(() => {
      expect(screen.getByTestId("anchor-deposit-btn")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("freighter-onramp-btn")).not.toBeInTheDocument();
  });

  it("shows the anchor deposit button when Freighter is not installed", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockResolvedValue(false);

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />);

    await waitFor(() => {
      expect(screen.getByTestId("anchor-deposit-btn")).toBeInTheDocument();
    });
  });

  it("shows the anchor deposit button when supportsRequestBuy() rejects", async () => {
    (walletLib.supportsRequestBuy as jest.Mock).mockRejectedValue(
      new Error("Freighter not installed")
    );

    render(<BuyXLMModal publicKey={MOCK_PK} onClose={noop} />);

    await waitFor(() => {
      expect(screen.getByTestId("anchor-deposit-btn")).toBeInTheDocument();
    });
  });
});
