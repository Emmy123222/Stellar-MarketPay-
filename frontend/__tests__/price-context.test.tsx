import { render, screen, waitFor } from "@testing-library/react";
import { PriceProvider, usePriceContext } from "@/contexts/PriceContext";

function PriceProbe() {
  const { xlmPriceUsd, priceLoading, currencyMode } = usePriceContext();

  return (
    <div>
      <span data-testid="price">{xlmPriceUsd ?? "none"}</span>
      <span data-testid="loading">{String(priceLoading)}</span>
      <span data-testid="currency">{currencyMode}</span>
    </div>
  );
}

function OutsideProviderProbe() {
  usePriceContext();
  return null;
}

describe("PriceContext", () => {
  let consoleErrorSpy: jest.SpyInstance;
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as Partial<typeof globalThis>).fetch;
    }
    jest.restoreAllMocks();
  });

  it("throws a descriptive error outside PriceProvider", () => {
    expect(() => render(<OutsideProviderProbe />)).toThrow(
      "usePriceContext must be used within a PriceProvider",
    );
  });

  it("provides live XLM/USD price values inside PriceProvider", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ stellar: { usd: 0.12 } }),
    } as Response);

    render(
      <PriceProvider>
        <PriceProbe />
      </PriceProvider>,
    );

    expect(screen.getByTestId("currency")).toHaveTextContent("XLM");

    await waitFor(() => {
      expect(screen.getByTestId("price")).toHaveTextContent("0.12");
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
  });
});
