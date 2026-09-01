/**
 * Unit tests for sorobanFees.ts — fee estimation utilities.
 * Issue #845: Add gas fee estimator before submitting a Soroban transaction.
 */
import {
  stroopsToXlm,
  calculateMaxFee,
  tierToTransactionFee,
  describeContractCall,
  fetchGasEstimateSafe,
} from "@/lib/sorobanFees";
import type { FeeTier } from "@/lib/sorobanFees";

describe("stroopsToXlm", () => {
  it("converts 0 stroops to '0'", () => {
    expect(stroopsToXlm(BigInt(0))).toBe("0");
  });

  it("converts 100 stroops to 0.00001", () => {
    expect(stroopsToXlm(BigInt(100))).toBe("0.00001");
  });

  it("converts 10_000_000 stroops (1 XLM) to '1'", () => {
    expect(stroopsToXlm(BigInt(10_000_000))).toBe("1");
  });

  it("converts 15_000_000 stroops (1.5 XLM) to '1.5'", () => {
    expect(stroopsToXlm(BigInt(15_000_000))).toBe("1.5");
  });

  it("converts 12_345_678 stroops to a fractional XLM string", () => {
    const result = stroopsToXlm(BigInt(12_345_678));
    expect(result).toMatch(/^1\.\d+$/);
    // Each XLM is 10M stroops, so 12,345,678 should yield ~1.2345678
    expect(parseFloat(result)).toBeCloseTo(1.2345678, 6);
  });

  it("handles very large values without scientific notation", () => {
    const result = stroopsToXlm(BigInt("10000000000000000")); // 1 billion XLM
    expect(result).toBe("1000000000");
    expect(result).not.toContain("e");
  });

  it("strips trailing zeros from the fractional part", () => {
    const result = stroopsToXlm(BigInt(10_001_000)); // 1.0001 exactly
    expect(result).toBe("1.0001");
  });

  it("returns only integer part when fraction is zero", () => {
    expect(stroopsToXlm(BigInt(50_000_000))).toBe("5");
  });
});

describe("calculateMaxFee", () => {
  it("returns base stroops when multiplier is 1", () => {
    expect(calculateMaxFee(BigInt(100_000), 1)).toBe(BigInt(100_000));
  });

  it("doubles the fee when multiplier is 2", () => {
    expect(calculateMaxFee(BigInt(100_000), 2)).toBe(BigInt(200_000));
  });

  it("triples the fee when multiplier is 3", () => {
    expect(calculateMaxFee(BigInt(100_000), 3)).toBe(BigInt(300_000));
  });

  it("handles 1.5x multiplier", () => {
    expect(calculateMaxFee(BigInt(100_000), 1.5)).toBe(BigInt(150_000));
  });

  it("handles 2.5x multiplier", () => {
    expect(calculateMaxFee(BigInt(100_000), 2.5)).toBe(BigInt(250_000));
  });

  it("rounds multiplier to nearest 0.5 step", () => {
    // 1.3 rounds to 1.5 * 2 = 3, so 100_000 * 3 / 2 = 150_000
    const result = calculateMaxFee(BigInt(100_000), 1.3);
    expect(result).toBe(BigInt(150_000));
  });

  it("works with zero base fee", () => {
    expect(calculateMaxFee(BigInt(0), 2)).toBe(BigInt(0));
  });

  it("works with large stroop values", () => {
    const large = BigInt("1000000000000");
    expect(calculateMaxFee(large, 2)).toBe(large * BigInt(2));
  });
});

describe("tierToTransactionFee", () => {
  const baseTier: FeeTier = {
    label: "medium",
    stroops: 200,
    xlm: "0.0000200",
    usd: null,
  };

  it("applies the default 10% buffer", () => {
    // 200 * 1.1 = 220 (ceil accounts for floating-point)
    const expected = String(Math.ceil(200 * 1.1));
    expect(tierToTransactionFee(baseTier)).toBe(expected);
  });

  it("applies a custom buffer percentage", () => {
    // 200 * 1.5 = 300
    expect(tierToTransactionFee(baseTier, 50)).toBe("300");
  });

  it("never goes below the protocol minimum of 100", () => {
    const lowTier: FeeTier = { label: "slow", stroops: 10, xlm: "0.0000010", usd: null };
    // 10 * 1.1 = 11, max(11, 100) = 100
    expect(tierToTransactionFee(lowTier)).toBe("100");
  });

  it("returns a string", () => {
    expect(typeof tierToTransactionFee(baseTier)).toBe("string");
  });

  it("handles zero buffer", () => {
    expect(tierToTransactionFee(baseTier, 0)).toBe("200");
  });
});

describe("describeContractCall", () => {
  const knownCalls: Record<string, string> = {
    create_escrow: "Lock job budget in escrow",
    start_work: "Mark job as in progress",
    release_escrow: "Release escrow to freelancer",
    release_with_conversion: "Release escrow with currency conversion",
    refund_escrow: "Refund escrow to client",
    raise_dispute: "Raise dispute on escrow",
    mint_certificate: "Mint completion certificate",
    cast_vote: "Cast governance vote",
  };

  for (const [fnName, expected] of Object.entries(knownCalls)) {
    it(`returns "${expected}" for ${fnName}`, () => {
      expect(describeContractCall(fnName)).toBe(expected);
    });
  }

  it("falls back to replacing underscores with spaces for unknown functions", () => {
    expect(describeContractCall("unknown_function")).toBe("unknown function");
  });

  it("handles a simple single-word function name", () => {
    expect(describeContractCall("test")).toBe("test");
  });

  it("handles empty string", () => {
    expect(describeContractCall("")).toBe("");
  });
});

describe("fetchGasEstimateSafe", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("returns fallback values when the API is unreachable", async () => {
    // Mock fetch to reject (jsdom has no native fetch)
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const result = await fetchGasEstimateSafe();

    expect(result.fallback).toBe(true);
    expect(result.slow.stroops).toBe(100);
    expect(result.medium.stroops).toBe(200);
    expect(result.fast.stroops).toBe(1000);
    expect(result.networkCongestion).toBe("unknown");
    expect(result.cached).toBe(false);
  });

  it("returns fallback values when API returns non-OK status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await fetchGasEstimateSafe();

    expect(result.fallback).toBe(true);
    expect(result.slow.stroops).toBe(100);
  });

  it("returns fallback with null USD values by default", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const result = await fetchGasEstimateSafe();

    expect(result.slow.usd).toBeNull();
    expect(result.medium.usd).toBeNull();
    expect(result.fast.usd).toBeNull();
  });

  it("returns a valid updatedAt timestamp even in fallback", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    const result = await fetchGasEstimateSafe();
    const timestamp = Date.parse(result.updatedAt);
    expect(Number.isFinite(timestamp)).toBe(true);
  });
});
