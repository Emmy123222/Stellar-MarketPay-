"use strict";

const { normalizeIp, getClientIp, getTrustedProxyIps } = require("./clientIp");

describe("getClientIp", () => {
  const originalTrustedProxies = process.env.TRUSTED_PROXY_IPS;

  afterEach(() => {
    if (originalTrustedProxies === undefined) {
      delete process.env.TRUSTED_PROXY_IPS;
    } else {
      process.env.TRUSTED_PROXY_IPS = originalTrustedProxies;
    }
  });

  it("ignores spoofed X-Forwarded-For on direct connections", () => {
    delete process.env.TRUSTED_PROXY_IPS;

    const req = {
      app: { get: () => 1 },
      ip: "198.51.100.20",
      headers: { "x-forwarded-for": "198.51.100.20" },
      socket: { remoteAddress: "::ffff:203.0.113.10" },
    };

    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("uses req.ip when the socket peer is a configured trusted proxy", () => {
    process.env.TRUSTED_PROXY_IPS = "10.0.0.5";

    const req = {
      app: { get: () => 1 },
      ip: "203.0.113.10",
      headers: { "x-forwarded-for": "203.0.113.10" },
      socket: { remoteAddress: "10.0.0.5" },
    };

    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(getTrustedProxyIps()).toEqual([]);
  });
});
