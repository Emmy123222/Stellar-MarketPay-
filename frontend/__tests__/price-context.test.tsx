import { render, screen, waitFor, act } from "@testing-library/react";
import { PriceProvider, usePriceContext } from "@/contexts/PriceContext";

function PriceProbe() {
  const { xlmPriceUsd, change24hPercent, priceLoading, currencyMode } =
    usePriceContext();

  return (
    <div>
      <span data-testid="price">{xlmPriceUsd ?? "none"}</span>
      <span data-testid="change">{change24hPercent ?? "none"}</span>
      <span data-testid="loading">{String(priceLoading)}</span>
      <span data-testid="currency">{currencyMode}</span>
    </div>
  );
}

function OutsideProviderProbe() {
  usePriceContext();
  return null;
}

// CoinGecko coins/markets response shape (array of market entries).
const MARKETS_RESPONSE = [
  { current_price: 0.12, price_change_percentage_24h: 1.5 },
];

describe("PriceContext", () => {
  let consoleErrorSpy: jest.SpyInstance;
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => MARKETS_RESPONSE,
    } as Response);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as Partial<typeof globalThis>).fetch;
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("throws a descriptive error outside PriceProvider", () => {
    expect(() => render(<OutsideProviderProbe />)).toThrow(
      "usePriceContext must be used within a PriceProvider",
    );
  });

  it("provides live XLM/USD price and 24h change inside PriceProvider", async () => {
    render(
      <PriceProvider>
        <PriceProbe />
      </PriceProvider>,
    );

    expect(screen.getByTestId("currency")).toHaveTextContent("XLM");

    await waitFor(() => {
      expect(screen.getByTestId("price")).toHaveTextContent("0.12");
      expect(screen.getByTestId("change")).toHaveTextContent("1.5");
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
  });

  it("issues a single fetch for multiple consumers of the context", async () => {
    render(
      <PriceProvider>
        <PriceProbe />
        <PriceProbe />
        <PriceProbe />
      </PriceProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("price")[0]).toHaveTextContent("0.12");
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes the shared price once per minute for all consumers", async () => {
    jest.useFakeTimers();

    render(
      <PriceProvider>
        <PriceProbe />
      </PriceProvider>,
    );

    // Initial fetch on mount
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
