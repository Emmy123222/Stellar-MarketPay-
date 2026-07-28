/**
 * __tests__/wallet-account-monitor.test.tsx
 * Issue #499 — Tests for WalletAccountMonitor: Freighter account change and
 * disconnection handling using a mock Freighter API.
 */
import { render, act, waitFor } from "@testing-library/react";

// ── Module mocks (hoisted by Jest) ────────────────────────────────────────────

jest.mock("@/lib/wallet", () => ({
  subscribeToAccountChanges: jest.fn().mockReturnValue(() => {}),
  getConnectedPublicKey: jest.fn().mockResolvedValue(null),
  isFreighterInstalled: jest.fn().mockResolvedValue(true),
  connectWallet: jest.fn(),
  performSEP0010Auth: jest.fn(),
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  setJwtToken: jest.fn(),
  getJwtToken: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("100"),
}));

jest.mock("@/components/BuyXLMModal", () => ({
  __esModule: true,
  default: () => null,
}));

const mockInfo = jest.fn();
jest.mock("@/components/Toast", () => ({
  useToast: () => ({ success: jest.fn(), error: jest.fn(), info: mockInfo }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import WalletAccountMonitor from "@/components/WalletAccountMonitor";
import * as walletLib from "@/lib/wallet";
import * as apiLib from "@/lib/api";
import * as stellarLib from "@/lib/stellar";

const MOCK_PK = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const MOCK_PK_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("WalletAccountMonitor (#499)", () => {
  let onDisconnect: jest.Mock;

  beforeEach(() => {
    onDisconnect = jest.fn();
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("smp_wallet_public_key", MOCK_PK);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders nothing (null output)", async () => {
    const { container } = render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );
    // Flush the initial balance poll (#871) so its state update doesn't leak
    // into the next test as an unwrapped act() warning.
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });

  it("subscribes via subscribeToAccountChanges on mount and unsubscribes on unmount", async () => {
    const unsubscribe = jest.fn();
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockReturnValue(unsubscribe);

    const { unmount } = render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );
    expect(walletLib.subscribeToAccountChanges).toHaveBeenCalledWith(expect.any(Function));

    await act(async () => {});
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("calls onDisconnect and clears JWT when a different account is reported", async () => {
    let capturedCb: ((pk: string | null) => void) | null = null;
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });
    const setJwtSpy = jest.spyOn(apiLib, "setJwtToken");

    render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    await act(async () => { capturedCb!(MOCK_PK_B); });

    expect(setJwtSpy).toHaveBeenCalledWith(null);
    expect(localStorage.getItem("smp_wallet_public_key")).toBeNull();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("calls onDisconnect when wallet disconnects (event delivers null)", async () => {
    let capturedCb: ((pk: string | null) => void) | null = null;
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });

    render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    await act(async () => { capturedCb!(null); });

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onDisconnect when the same account key is reported", async () => {
    let capturedCb: ((pk: string | null) => void) | null = null;
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });

    render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    await act(async () => { capturedCb!(MOCK_PK); });

    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("falls back to polling when subscribeToAccountChanges returns null and detects account change", async () => {
    jest.useFakeTimers();
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockReturnValue(null);
    jest.spyOn(walletLib, "getConnectedPublicKey").mockResolvedValue(MOCK_PK_B);

    render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    await act(async () => { jest.advanceTimersByTime(3500); });

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));

    jest.useRealTimers();
  });

  it("does nothing when currentPublicKey is null", () => {
    render(
      <WalletAccountMonitor currentPublicKey={null} onDisconnect={onDisconnect} />,
    );
    expect(walletLib.subscribeToAccountChanges).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("stops polling after unmount (no spurious onDisconnect calls)", () => {
    jest.useFakeTimers();
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockReturnValue(null);
    jest.spyOn(walletLib, "getConnectedPublicKey").mockResolvedValue(MOCK_PK);

    const { unmount } = render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );
    unmount();

    act(() => { jest.advanceTimersByTime(10000); });

    expect(onDisconnect).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe("WalletAccountMonitor — low-balance monitoring (#871)", () => {
  let onDisconnect: jest.Mock;
  let onBalanceChange: jest.Mock;

  beforeEach(() => {
    onDisconnect = jest.fn();
    onBalanceChange = jest.fn();
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("smp_wallet_public_key", MOCK_PK);
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockReturnValue(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("polls Horizon via getXLMBalance on mount and reports the balance upward", async () => {
    jest.spyOn(stellarLib, "getXLMBalance").mockResolvedValue("42.5");

    render(
      <WalletAccountMonitor
        currentPublicKey={MOCK_PK}
        onDisconnect={onDisconnect}
        onBalanceChange={onBalanceChange}
      />,
    );

    await waitFor(() => expect(stellarLib.getXLMBalance).toHaveBeenCalledWith(MOCK_PK));
    await waitFor(() => expect(onBalanceChange).toHaveBeenCalledWith("42.5"));
  });

  it("shows a low-balance banner once the balance drops below 5 XLM", async () => {
    jest.spyOn(stellarLib, "getXLMBalance").mockResolvedValue("2.5");

    const { findByRole } = render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    const banner = await findByRole("alert");
    expect(banner.textContent).toContain("2.50 XLM");
  });

  it("does not show a banner when the balance is at or above the 5 XLM reserve", async () => {
    jest.spyOn(stellarLib, "getXLMBalance").mockResolvedValue("50");

    render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    await waitFor(() => expect(stellarLib.getXLMBalance).toHaveBeenCalled());
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("fires a one-time warning toast once the balance drops below 10 XLM", async () => {
    jest.spyOn(stellarLib, "getXLMBalance").mockResolvedValue("8");

    render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    await waitFor(() =>
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining("Low balance warning")),
    );
    expect(mockInfo).toHaveBeenCalledTimes(1);
  });

  it("lets the user dismiss the banner for the session", async () => {
    jest.spyOn(stellarLib, "getXLMBalance").mockResolvedValue("1");

    const { findByRole, queryByRole } = render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );

    const banner = await findByRole("alert");
    const dismissButton = banner.querySelector('[aria-label="Dismiss low balance banner"]');
    expect(dismissButton).not.toBeNull();

    await act(async () => {
      dismissButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(queryByRole("alert")).toBeNull();
  });
});
