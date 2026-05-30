/**
 * contexts/PriceContext.tsx
 * Fetches XLM/USD price once on mount and shares it across the app.
 * Includes a global XLM/USD currency toggle.
 * Fails silently — components receive null if price is unavailable.
 */
import React, { createContext, useContext, useEffect, useState } from "react";

export type CurrencyMode = "XLM" | "USD";

const CURRENCY_STORAGE_KEY = "marketpay_currency_mode";

interface PriceContextValue {
  xlmPriceUsd: number | null;
  priceLoading: boolean;
  currencyMode: CurrencyMode;
  setCurrencyMode: (mode: CurrencyMode) => void;
}

const PriceContext = createContext<PriceContextValue>({
  xlmPriceUsd: null,
  priceLoading: true,
  currencyMode: "XLM",
  setCurrencyMode: () => {},
});

export function PriceProvider({ children }: { children: React.ReactNode }) {
  const [xlmPriceUsd, setXlmPriceUsd] = useState<number | null>(null);
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
    setPriceLoading(true);
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd")
      .then((res) => res.json())
      .then((data) => {
        const price = data?.stellar?.usd;
        if (typeof price === "number") setXlmPriceUsd(price);
      })
      .catch(() => {
        // Fail silently — USD equivalent simply won't show
      })
      .finally(() => setPriceLoading(false));
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
    <PriceContext.Provider value={{ xlmPriceUsd, priceLoading, currencyMode, setCurrencyMode }}>
      {children}
    </PriceContext.Provider>
  );
}

export function usePriceContext() {
  return useContext(PriceContext);
}
