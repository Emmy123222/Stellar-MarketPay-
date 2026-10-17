/**
 * Focus-management audit (#1896): every modal in the app must route through
 * AccessibleModal, so each one gets dialog/aria-modal semantics, a focus trap,
 * Escape-to-close and focus restoration to the control that opened it.
 */
import { useState, type ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import BoostJobModal from "@/components/BoostJobModal";
import BuyXLMModal from "@/components/BuyXLMModal";
import ConfirmDialog from "@/components/ConfirmDialog";
import ExtendJobModal from "@/components/ExtendJobModal";
import FeeEstimationModal from "@/components/FeeEstimationModal";
import PriceAlertModal from "@/components/PriceAlertModal";
import ShareJobModal from "@/components/ShareJobModal";
import WithdrawToBankModal from "@/components/WithdrawToBankModal";
import Admin2FAModal from "@/components/Admin2FAModal";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";

jest.mock("@/lib/wallet", () => ({
  supportsRequestBuy: jest.fn().mockResolvedValue(false),
  freighterRequestBuy: jest.fn(),
}));
jest.mock("@/lib/anchors", () => ({
  ANCHOR_HOME_DOMAIN: "anchor.example.com",
  fetchApprovedAnchors: jest.fn().mockResolvedValue([]),
  fetchAnchorEndpoints: jest.fn().mockResolvedValue({ currencies: [] }),
  startInteractiveDeposit: jest.fn(),
  pollAnchorTransaction: jest.fn(),
  fetchAnchorInfo: jest.fn().mockResolvedValue({}),
  startSep31Payment: jest.fn(),
}));
jest.mock("@/lib/sorobanFees", () => ({
  describeContractCall: () => "Submit payment",
  estimateSorobanFee: jest.fn().mockResolvedValue({
    totalStroops: BigInt(100_000),
    totalXlm: "0.01",
    totalUsd: 0.01,
    resourceFeeStroops: BigInt(90_000),
    inclusionFeeStroops: BigInt(10_000),
  }),
  stroopsToXlm: () => "0.01",
}));
jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("10"),
}));
jest.mock("@/contexts/PriceContext", () => ({
  usePriceContext: () => ({ xlmPriceUsd: 0.12 }),
}));
jest.mock("@/components/Toast", () => ({
  useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }),
}));
jest.mock("@/lib/api", () => ({
  createPriceAlert: jest.fn(),
  fetchPriceAlerts: jest.fn().mockResolvedValue([]),
  deletePriceAlert: jest.fn(),
  getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
  setupAdmin2FA: jest.fn(),
  verifyAdmin2FA: jest.fn(),
  setJwtToken: jest.fn(),
}));

const PK = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const job = {
  id: "job-1",
  title: "Build a landing page",
  budget: "100",
  currency: "XLM",
  clientAddress: PK,
  status: "open",
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
} as never;

interface ModalCase {
  name: string;
  /** false for flows that must be completed (no Escape / backdrop dismiss). */
  dismissible: boolean;
  build: (onClose: () => void) => ReactElement;
}

const cases: ModalCase[] = [
  {
    name: "BoostJobModal",
    dismissible: true,
    build: (onClose) => (
      <BoostJobModal
        jobId="job-1"
        jobTitle="Build a landing page"
        clientPublicKey={PK}
        onClose={onClose}
        onSuccess={jest.fn()}
      />
    ),
  },
  {
    name: "BuyXLMModal",
    dismissible: true,
    build: (onClose) => <BuyXLMModal publicKey={PK} onClose={onClose} />,
  },
  {
    name: "ConfirmDialog",
    dismissible: true,
    build: (onClose) => (
      <ConfirmDialog
        open
        title="Delete?"
        description="This cannot be undone."
        onConfirm={jest.fn()}
        onCancel={onClose}
      />
    ),
  },
  {
    name: "ExtendJobModal",
    dismissible: true,
    build: (onClose) => (
      <ExtendJobModal job={job} onClose={onClose} onExtended={jest.fn()} />
    ),
  },
  {
    name: "FeeEstimationModal",
    dismissible: true,
    build: (onClose) => (
      <FeeEstimationModal
        transaction={{} as never}
        amount="10"
        functionName="release_escrow"
        payerPublicKey={PK}
        platformFeeBps={100}
        onConfirm={jest.fn()}
        onCancel={onClose}
      />
    ),
  },
  {
    name: "PriceAlertModal",
    dismissible: true,
    build: (onClose) => (
      <PriceAlertModal open onClose={onClose} currentPriceUsd={0.12} />
    ),
  },
  {
    name: "ShareJobModal",
    dismissible: true,
    build: (onClose) => <ShareJobModal job={job} onClose={onClose} />,
  },
  {
    name: "WithdrawToBankModal",
    dismissible: true,
    build: (onClose) => <WithdrawToBankModal publicKey={PK} onClose={onClose} />,
  },
  {
    name: "Admin2FAModal",
    dismissible: false,
    build: () => <Admin2FAModal mode="verify" onComplete={jest.fn()} />,
  },
  {
    name: "KeyboardShortcutsModal",
    dismissible: true,
    build: (onClose) => <KeyboardShortcutsModal isOpen onClose={onClose} />,
  },
];

describe.each(cases)("$name focus management", ({ dismissible, build }) => {
  it("is an aria-modal dialog with an accessible name and description", () => {
    render(build(jest.fn()));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-describedby");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).not.toBeNull();
  });

  it("moves focus into the dialog on open", () => {
    render(build(jest.fn()));
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );
  });

  it(dismissible ? "closes on Escape" : "stays open on Escape", () => {
    const onClose = jest.fn();
    render(build(onClose));
    fireEvent.keyDown(document, { key: "Escape" });
    if (dismissible) expect(onClose).toHaveBeenCalled();
    else expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps Tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>outside</button>
        {build(jest.fn())}
      </>,
    );
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 20; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 20; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("restores focus to the trigger when it closes", async () => {
    if (!dismissible) return; // must be completed; nothing to dismiss
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>trigger</button>
          {open && build(() => setOpen(false))}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByText("trigger");
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
