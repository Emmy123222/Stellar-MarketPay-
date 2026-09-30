/**
 * contexts/PriceContext.tsx
 * Fetches XLM/USD price once on mount and shares it across the app.
 * Includes a global XLM/USD currency toggle.
 * Components must be rendered under PriceProvider.
 */
import React, { createContext, useContext, useEffect, useState } from "react";

export type CurrencyMode = "XLM" | "USD";

const CURRENCY_STORAGE_KEY = "marketpay_currency_mode";

/**
 * How often the shared XLM/USD price refreshes. All components that read the
 * price from context update together — no per-component polling anywhere.
 */
const PRICE_REFRESH_MS = 60_000;

interface PriceContextValue {
  xlmPriceUsd: number | null;
  /** 24h % change of XLM/USD, null when unavailable. */
  change24hPercent: number | null;
  priceLoading: boolean;
  currencyMode: CurrencyMode;
  setCurrencyMode: (mode: CurrencyMode) => void;
}

const PriceContext = createContext<PriceContextValue | undefined>(undefined);

export function PriceProvider({ children }: { children: React.ReactNode }) {
  const [xlmPriceUsd, setXlmPriceUsd] = useState<number | null>(null);
  const [change24hPercent, setChange24hPercent] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [currencyMode, setCurrencyModeState] = useState<CurrencyMode>("XLM");

  // Restore persisted currency preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(CURRENCY_STORAGE_KEY);
      if (stored === "XLM" || stored === "USD") {
        setCurrencyModeState(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Guards against a state update after unmount when the timer fires late.
    let cancelled = false;

    const loadPrice = async () => {
      try {
        // markets endpoint returns current price + 24h change in one request
        const res = await fetch(
          "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=stellar",
        );
        const data = await res.json();
        const market = Array.isArray(data) ? data[0] : undefined;
        const price = market?.current_price;
        const change = market?.price_change_percentage_24h;
        if (!cancelled) {
          if (typeof price === "number" && Number.isFinite(price))
            setXlmPriceUsd(price);
          if (typeof change === "number" && Number.isFinite(change)) {
            setChange24hPercent(change);
          } else {
            setChange24hPercent(null);
          }
        }
      } catch {
        // Fail silently — USD equivalent simply won't show. Keep the last
        // known price/change on transient failures instead of blanking UI.
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    };

    loadPrice();
    const interval = setInterval(loadPrice, PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const setCurrencyMode = (mode: CurrencyMode) => {
    setCurrencyModeState(mode);
    try {
      localStorage.setItem(CURRENCY_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  return (
    <PriceContext.Provider
      value={{
        xlmPriceUsd,
        change24hPercent,
        priceLoading,
        currencyMode,
        setCurrencyMode,
      }}
    >
      {children}
    </PriceContext.Provider>
  );
}

export function usePriceContext() {
  const context = useContext(PriceContext);

  if (!context) {
    throw new Error("usePriceContext must be used within a PriceProvider");
  }

  return context;
}
