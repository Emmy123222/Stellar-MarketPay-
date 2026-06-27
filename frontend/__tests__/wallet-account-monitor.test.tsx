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

jest.mock("@/components/Toast", () => ({
  useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import WalletAccountMonitor from "@/components/WalletAccountMonitor";
import * as walletLib from "@/lib/wallet";
import * as apiLib from "@/lib/api";

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

  it("renders nothing (null output)", () => {
    const { container } = render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("subscribes via subscribeToAccountChanges on mount and unsubscribes on unmount", () => {
    const unsubscribe = jest.fn();
    jest.spyOn(walletLib, "subscribeToAccountChanges").mockReturnValue(unsubscribe);

    const { unmount } = render(
      <WalletAccountMonitor currentPublicKey={MOCK_PK} onDisconnect={onDisconnect} />,
    );
    expect(walletLib.subscribeToAccountChanges).toHaveBeenCalledWith(expect.any(Function));

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
