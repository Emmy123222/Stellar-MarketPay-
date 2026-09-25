/**
 * __tests__/WalletAddressDisplay.test.tsx
 *
 * Unit tests for the WalletAddressDisplay chip: address shortening, live
 * balance fetching, copy-to-clipboard feedback, and navigation.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import WalletAddressDisplay from "@/components/WalletAddressDisplay";
import { shortenAddress } from "@/utils/format";
import { MOCK_PK } from "./helpers/fixtures";

jest.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: jest.fn() },
    ready: true,
  }),
}));

jest.mock("@/lib/stellar", () => ({
  getXLMBalance: jest.fn().mockResolvedValue("100"),
  getUSDCBalance: jest.fn().mockResolvedValue("0"),
}));

const mockPush = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ pathname: "/", push: mockPush, query: {}, isReady: true }),
}));

describe("WalletAddressDisplay", () => {
  beforeEach(() => {
    mockPush.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders the shortened address and live XLM/USDC balances", async () => {
    render(<WalletAddressDisplay address={MOCK_PK} />);

    // Shortened address is rendered twice (desktop + mobile variants).
    const shortened = shortenAddress(MOCK_PK, 6);
    expect(screen.getAllByText(shortened).length).toBeGreaterThan(0);

    // Balances come from the real lib/stellar helpers (mocked at module level).
    expect(
      await screen.findByText("100.00 XLM / 0.00 USDC"),
    ).toBeInTheDocument();
  });

  it("honors the truncatedChars prop", () => {
    render(<WalletAddressDisplay address={MOCK_PK} truncatedChars={4} />);
    const shortened = shortenAddress(MOCK_PK, 4);
    expect(screen.getAllByText(shortened).length).toBeGreaterThan(0);
  });

  it("copies the full address to the clipboard and shows feedback", async () => {
    render(<WalletAddressDisplay address={MOCK_PK} />);

    fireEvent.click(screen.getByRole("button", { name: "wallet.copyAddress" }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MOCK_PK);
    expect(await screen.findByText("wallet.copied")).toBeInTheDocument();
  });

  it("navigates to the transaction history when the chip is clicked", () => {
    render(<WalletAddressDisplay address={MOCK_PK} />);

    fireEvent.click(screen.getByTitle("wallet.balance"));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/transactions");
  });
});
