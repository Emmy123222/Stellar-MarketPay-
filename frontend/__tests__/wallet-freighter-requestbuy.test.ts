/**
 * __tests__/wallet-freighter-requestbuy.test.ts
 * Unit tests for the Freighter requestBuy() helpers in lib/wallet.ts.
 *
 * `window` is a non-configurable accessor on globalThis in jsdom, so these
 * tests mutate `window.freighter` directly instead of redefining `window`.
 * The "no window at all" branch is covered in
 * `wallet-freighter-nowindow.test.ts`, which runs in the node environment.
 */
import {
  parseVersion,
  isVersionAtLeast,
  getFreighterVersion,
  supportsRequestBuy,
  freighterRequestBuy,
  FREIGHTER_REQUEST_BUY_MIN_VERSION,
} from "../lib/wallet";

const win = window as unknown as { freighter?: unknown };

afterEach(() => {
  delete win.freighter;
});

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
  it("returns null when window.freighter is not present", async () => {
    delete win.freighter;
    const version = await getFreighterVersion();
    expect(version).toBeNull();
  });

  it("returns null when window.freighter.getVersion is absent", async () => {
    win.freighter = { isConnected: jest.fn() };
    const version = await getFreighterVersion();
    expect(version).toBeNull();
  });

  it("returns the version string from window.freighter.getVersion()", async () => {
    win.freighter = {
      getVersion: jest.fn().mockResolvedValue("5.2.1"),
    };
    const version = await getFreighterVersion();
    expect(version).toBe("5.2.1");
  });

  it("returns null when getVersion() throws", async () => {
    win.freighter = {
      getVersion: jest.fn().mockRejectedValue(new Error("Not available")),
    };
    const version = await getFreighterVersion();
    expect(version).toBeNull();
  });
});

// ── supportsRequestBuy ────────────────────────────────────────────────────────

describe("supportsRequestBuy", () => {
  it("returns false when window.freighter is absent", async () => {
    delete win.freighter;
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns false when requestBuy() method is absent on window.freighter", async () => {
    win.freighter = {
      getVersion: jest.fn().mockResolvedValue("5.2.1"),
      // no requestBuy
    };
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns false when version is below minimum even if requestBuy() is present", async () => {
    win.freighter = {
      getVersion: jest.fn().mockResolvedValue("4.9.9"),
      requestBuy: jest.fn(),
    };
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns false when getVersion() returns null", async () => {
    win.freighter = {
      getVersion: jest.fn().mockResolvedValue(null),
      requestBuy: jest.fn(),
    };
    expect(await supportsRequestBuy()).toBe(false);
  });

  it("returns true when requestBuy() is present and version >= minimum", async () => {
    win.freighter = {
      getVersion: jest.fn().mockResolvedValue("5.0.0"),
      requestBuy: jest.fn(),
    };
    expect(await supportsRequestBuy()).toBe(true);
  });

  it("returns true for a newer version", async () => {
    win.freighter = {
      getVersion: jest.fn().mockResolvedValue("6.1.0"),
      requestBuy: jest.fn(),
    };
    expect(await supportsRequestBuy()).toBe(true);
  });
});

// ── freighterRequestBuy ───────────────────────────────────────────────────────

describe("freighterRequestBuy", () => {
  it("throws when window.freighter.requestBuy is not available", async () => {
    win.freighter = {};
    await expect(freighterRequestBuy("XLM")).rejects.toThrow(
      "Freighter requestBuy() is not available in this version."
    );
  });

  it("calls window.freighter.requestBuy with the correct asset code", async () => {
    const mockRequestBuy = jest.fn().mockResolvedValue(undefined);
    win.freighter = { requestBuy: mockRequestBuy };

    await freighterRequestBuy("XLM");
    expect(mockRequestBuy).toHaveBeenCalledWith({ assetCode: "XLM" });
  });

  it("propagates errors from window.freighter.requestBuy()", async () => {
    const mockRequestBuy = jest
      .fn()
      .mockRejectedValue(new Error("User declined to complete the purchase."));
    win.freighter = { requestBuy: mockRequestBuy };

    await expect(freighterRequestBuy("XLM")).rejects.toThrow(
      "User declined to complete the purchase."
    );
  });
});
