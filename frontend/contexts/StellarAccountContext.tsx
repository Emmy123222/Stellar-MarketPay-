import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { server } from "@/lib/stellar";

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  account: unknown;
  timestamp: number;
}

interface StellarAccountContextValue {
  getAccount: (publicKey: string) => Promise<unknown>;
  invalidate: (publicKey: string) => void;
  invalidateAll: () => void;
}

const StellarAccountContext = createContext<StellarAccountContextValue | null>(null);

export function StellarAccountProvider({ children }: { children: React.ReactNode }) {
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const [, setTick] = useState(0);

  const getAccount = useCallback(async (publicKey: string): Promise<unknown> => {
    const now = Date.now();
    const cached = cacheRef.current.get(publicKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.account;
    }

    const pending = inFlightRef.current.get(publicKey);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const account = await server.accounts().accountId(publicKey).call();
        cacheRef.current.set(publicKey, { account, timestamp: Date.now() });
        return account;
      } finally {
        inFlightRef.current.delete(publicKey);
      }
    })();

    inFlightRef.current.set(publicKey, promise);
    return promise;
  }, []);

  const invalidate = useCallback((publicKey: string) => {
    cacheRef.current.delete(publicKey);
    setTick((t) => t + 1);
  }, []);

  const invalidateAll = useCallback(() => {
    cacheRef.current.clear();
    setTick((t) => t + 1);
  }, []);

  return (
    <StellarAccountContext.Provider value={{ getAccount, invalidate, invalidateAll }}>
      {children}
    </StellarAccountContext.Provider>
  );
}

export function useStellarAccount(): StellarAccountContextValue {
  const ctx = useContext(StellarAccountContext);
  if (!ctx) {
    throw new Error("useStellarAccount must be used within a StellarAccountProvider");
  }
  return ctx;
}

export { CACHE_TTL_MS };
