"use strict";

const request = require("supertest");
const { createApp } = require("./app");

describe("App factory route smoke test", () => {
  let app;

  beforeAll(() => {
    app = createApp({
      indexerService: {
        getHealth: () => ({ status: "synced", ledger: 12345 }),
      },
      broadcastRealtime: jest.fn(),
    });
  });

  it("can be imported and instantiated without binding a port", () => {
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
  });

  const expectedPrefixes = [
    { prefix: "/health" },
    { prefix: "/api/auth/challenge" },
    { prefix: "/api/jobs" },
    { prefix: "/api/applications" },
    { prefix: "/api/profiles" },
    { prefix: "/api/escrow" },
    { prefix: "/api/ratings" },
    { prefix: "/api/progress" },
    { prefix: "/api/events" },
    { prefix: "/api/stats" },
    { prefix: "/api/contributors" },
    { prefix: "/api/verification" },
    { prefix: "/api/nft" },
    { prefix: "/api/ai-scorer" },
    { prefix: "/api/anchors" },
    { prefix: "/api/indexer/health" },
    { prefix: "/api/gas-estimate" },
    { prefix: "/api/transactions" },
    { prefix: "/api/dao" },
    { prefix: "/api/proposal-templates" },
    { prefix: "/api/price-alerts" },
    { prefix: "/api/ai" },
    { prefix: "/api/scope" },
    { prefix: "/api/turrets" },
    { prefix: "/api/referrals" },
    { prefix: "/api/reputation" },
    { prefix: "/api/auto-convert" },
    { prefix: "/api/talent-pools" },
    { prefix: "/api/invitations" },
    { prefix: "/api/analytics" },
    { prefix: "/api/search" },
  ];

  it.each(expectedPrefixes)(
    "smoke checks expected route prefix $prefix responds from router (not 404 NOT_FOUND)",
    async ({ prefix }) => {
      const res = await request(app).get(prefix);
      // Mounted routes will return their handler status or 401/400/403/etc.
      // Unmounted paths fall through to app's 404 handler returning { code: "NOT_FOUND" }.
      if (res.status === 404) {
        expect(res.body?.code).not.toBe("NOT_FOUND");
      } else {
        expect(res.status).toBeLessThan(500);
      }
    }
  );

  it("returns 404 with NOT_FOUND code for unknown routes", async () => {
    const res = await request(app).get("/api/non-existent-endpoint-smoke-test");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found", code: "NOT_FOUND" });
  });

  it("serves /api/indexer/health using the injected indexer service", async () => {
    const res = await request(app).get("/api/indexer/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      indexer: { status: "synced", ledger: 12345 },
    });
  });
});
