/**
 * __tests__/wallet-freighter-requestbuy.test.ts
 * Unit tests for the Freighter requestBuy() helpers in lib/wallet.ts.
 */
import {
  parseVersion,
  isVersionAtLeast,
  getFreighterVersion,
  supportsRequestBuy,
  freighterRequestBuy,
  FREIGHTER_REQUEST_BUY_MIN_VERSION,
} from "../lib/wallet";

// ── parseVersion ──────────────────────────────────────────────────────────────

describe("parseVersion", () => {
  it("parses a full semver string", () => {
    expect(parseVersion("5.3.2")).toEqual([5, 3, 2]);
  });

  it("parses a two-part version", () => {
    expect(parseVersion("5.3")).toEqual([5, 3, 0]);
  });

  it("parses a single number", () => {
    expect(parseVersion("5")).toEqual([5, 0, 0]);
  });

  it("strips pre-release suffixes", () => {
    expect(parseVersion("5.0.0-beta.1")).toEqual([5, 0, 0]);
  });

  it("handles non-numeric parts gracefully", () => {
    expect(parseVersion("abc")).toEqual([0, 0, 0]);
  });
});

// ── isVersionAtLeast ──────────────────────────────────────────────────────────

describe("isVersionAtLeast", () => {
  const MIN = FREIGHTER_REQUEST_BUY_MIN_VERSION; // "5.0.0"

  it("returns true for a version equal to minimum", () => {
    expect(isVersionAtLeast("5.0.0", MIN)).toBe(true);
  });

  it("returns true for a version higher than minimum (major)", () => {
    expect(isVersionAtLeast("6.0.0", MIN)).toBe(true);
  });

  it("returns true for a version higher than minimum (minor)", () => {
    expect(isVersionAtLeast("5.1.0", MIN)).toBe(true);
  });

  it("returns true for a version higher than minimum (patch)", () => {
    expect(isVersionAtLeast("5.0.1", MIN)).toBe(true);
  });

  it("returns false for a lower major version", () => {
    expect(isVersionAtLeast("4.99.99", MIN)).toBe(false);
  });

  it("returns false for same major but lower minor", () => {
    expect(isVersionAtLeast("4.9.9", "5.0.0")).toBe(false);
  });

  it("returns false for same major.minor but lower patch", () => {
    expect(isVersionAtLeast("5.0.0", "5.0.1")).toBe(false);
  });
});

// ── getFreighterVersion ───────────────────────────────────────────────────────

describe("getFreighterVersion", () => {
  const originalWindow = global.window;

  afterEach(() => {
    // Restore window
    Object.defineProperty(global, "window", {
      value: originalWindow,
      writable: true,
    });
  });

  it("returns null when window is undefined", async () => {
    Object.defineProperty(global, "window", { value: undefined, writable: true });
    const version = await getFreighterVersion();
    expect(version).toBeNull();
  });

  it("returns null when window.freighter is not present", async () => {
    Object.defineProperty(global, "window", {
      value: { freighter: undefined },
      writable: true,
    });
    const version = await getFreighterVersion();
    expect(version).toBeNull();
  });

  it("returns null when window.freighter.getVersion is absent", async () => {
    Object.defineProperty(global, "window", {
      value: { freighter: { isConnected: jest.fn() } },
      writable: true,
    });
    const version = await getFreighterVersion();
    expect(version).toBeNull();
  });

  it("returns the version string from window.freighter.getVersion()", async () => {
    Object.defineProperty(global, "window", {
      value: {
        freighter: {
          getVersion: jest.fn().mockResolvedValue("5.2.1"),
        },
      },
      writable: true,
    });
    const version = await getFreighterVersion();
    expect(version).toBe("5.2.1");
  });

  it("returns null when getVersion() throws", async () => {
    Object.defineProperty(global, "window", {
      value: {
        freighter: {
          getVersion: jest.fn().mockRejectedValue(new Error("Not available")),
        },
      },
      writable: true,
    });
    const version = await getFreighterVersion();
    expect(version).toBeNull();
  });
});

// ── supportsRequestBuy ────────────────────────────────────────────────────────

describe("supportsRequestBuy", () => {
  afterEach(() => {
    Object.defineProperty(global, "window", {
      value: undefined,
      writable: true,
    });
  });

  it("returns false when window.freighter is absent", async () => {
    Object.defineProperty(global, "window", {
      value: { freighter: undefined },
      writable: true,
    });
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns false when requestBuy() method is absent on window.freighter", async () => {
    Object.defineProperty(global, "window", {
      value: {
        freighter: {
          getVersion: jest.fn().mockResolvedValue("5.2.1"),
          // no requestBuy
        },
      },
      writable: true,
    });
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns false when version is below minimum even if requestBuy() is present", async () => {
    Object.defineProperty(global, "window", {
      value: {
        freighter: {
          getVersion: jest.fn().mockResolvedValue("4.9.9"),
          requestBuy: jest.fn(),
        },
      },
      writable: true,
    });
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns false when getVersion() returns null", async () => {
    Object.defineProperty(global, "window", {
      value: {
        freighter: {
          getVersion: jest.fn().mockResolvedValue(null),
          requestBuy: jest.fn(),
        },
      },
      writable: true,
    });
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns true when requestBuy() is present and version >= minimum", async () => {
    Object.defineProperty(global, "window", {
      value: {
        freighter: {
          getVersion: jest.fn().mockResolvedValue("5.0.0"),
          requestBuy: jest.fn(),
        },
      },
      writable: true,
    });
    expect(await supportsRequestBuy()).toBe(true);
  });

  it("returns true for a newer version", async () => {
    Object.defineProperty(global, "window", {
      value: {
        freighter: {
          getVersion: jest.fn().mockResolvedValue("6.1.0"),
          requestBuy: jest.fn(),
        },
      },
      writable: true,
    });
    expect(await supportsRequestBuy()).toBe(true);
  });
});

// ── freighterRequestBuy ───────────────────────────────────────────────────────

describe("freighterRequestBuy", () => {
  afterEach(() => {
    Object.defineProperty(global, "window", {
      value: undefined,
      writable: true,
    });
  });

  it("throws when window.freighter.requestBuy is not available", async () => {
    Object.defineProperty(global, "window", {
      value: { freighter: {} },
      writable: true,
    });
    await expect(freighterRequestBuy("XLM")).rejects.toThrow(
      "Freighter requestBuy() is not available in this version."
    );
  });

  it("calls window.freighter.requestBuy with the correct asset code", async () => {
    const mockRequestBuy = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, "window", {
      value: {
        freighter: { requestBuy: mockRequestBuy },
      },
      writable: true,
    });

    await freighterRequestBuy("XLM");
    expect(mockRequestBuy).toHaveBeenCalledWith({ assetCode: "XLM" });
  });

  it("propagates errors from window.freighter.requestBuy()", async () => {
    const mockRequestBuy = jest
      .fn()
      .mockRejectedValue(new Error("User declined to complete the purchase."));
    Object.defineProperty(global, "window", {
      value: {
        freighter: { requestBuy: mockRequestBuy },
      },
      writable: true,
    });

    await expect(freighterRequestBuy("XLM")).rejects.toThrow(
      "User declined to complete the purchase."
    );
  });
});
