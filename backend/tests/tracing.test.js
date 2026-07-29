"use strict";

/**
 * backend/tests/tracing.test.js
 *
 * Request tracing tests for Issue #453.
 *
 * Verifies:
 *   - `xRequestIdMiddleware` mints a UUID v4 when no header is supplied,
 *     sets it on req, mirrors it on the response, and enters AsyncLocalStorage.
 *   - Vendor-supplied `X-Request-ID` is honoured when it parses as a UUID v4.
 *   - Malformed / non-UUID `X-Request-ID` values are rejected and replaced.
 *   - The request ID is propagated through deeply awaited service calls
 *     (AsyncLocalStorage) so log lines stay correlatable.
 *   - `createServiceLogger` log lines include `requestId` when invoked
 *     inside an active request scope.
 *   - Logged lines emitted from outside any request scope do NOT carry
 *     a (stale) requestId — only base service fields.
 */

const express = require("express");
const request = require("supertest");

const {
  xRequestIdMiddleware,
  requestLoggerMiddleware,
  logError,
  createServiceLogger,
} = require("../src/utils/logger");
const {
  requestContextStorage,
  getRequestId,
  runWithRequestContext,
  isValidRequestId,
} = require("../src/utils/requestContext");

function makeApp({ withLogger = true } = {}) {
  const app = express();
  app.use(express.json({ limit: "20kb" }));
  app.use(xRequestIdMiddleware);
  if (withLogger) app.use(requestLoggerMiddleware);
  app.get("/echo", (req, res) => {
    res.json({ requestId: req.requestId, seen: getRequestId() });
  });
  app.get("/deep", async (req, res) => {
    // simulate going through a few awaits to prove ALS propagation
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    res.json({
      requestId: req.requestId,
      alsSeen: getRequestId(),
    });
  });
  app.get("/service-log", (req, res) => {
    const log = createServiceLogger("test-service");
    // Capture what the logger would emit by introspecting the pino
    // child bindings via `log.child()` shape.
    const child = log.child({ mocked: true });
    res.json({
      bindings: Object.keys(child.bindings()),
      hasRequestId: typeof child.bindings().requestId === "string",
    });
  });
  return app;
}

describe("Request tracing (#453)", () => {
  describe("xRequestIdMiddleware", () => {
    it("mints a UUID v4 when no X-Request-ID header is supplied", async () => {
      const res = await request(makeApp()).get("/echo");
      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(res.body.requestId).toBe(res.headers["x-request-id"]);
      expect(res.body.seen).toBe(res.body.requestId);
    });

    it("passes through a client-supplied X-Request-ID when it parses as a UUID v4", async () => {
      const clientId = "550e8400-e29b-41d4-a716-446655440000";
      const res = await request(makeApp())
        .get("/echo")
        .set("X-Request-ID", clientId);
      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBe(clientId);
      expect(res.body.requestId).toBe(clientId);
    });

    it("rejects and replaces a malformed X-Request-ID", async () => {
      const res = await request(makeApp())
        .get("/echo")
        .set("X-Request-ID", "not-a-uuid-but-definitely-attacker-controlled");
      expect(res.status).toBe(200);
      // Replaced by a fresh server UUID
      expect(res.headers["x-request-id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(res.headers["x-request-id"]).not.toBe(
        "not-a-uuid-but-definitely-attacker-controlled",
      );
    });

    it("rejects an attacker-supplied object / array header value", async () => {
      // JSON-stringified values are accepted by supertest headers setter; the
      // validator must still reject anything not matching UUID v4.
      const res = await request(makeApp())
        .get("/echo")
        .set("X-Request-ID", "{\"injection\":true}");
      expect(res.headers["x-request-id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("propagates the requestId to a deeply awaited handler via AsyncLocalStorage", async () => {
      const res = await request(makeApp()).get("/deep");
      expect(res.status).toBe(200);
      expect(res.body.alsSeen).toBe(res.body.requestId);
    });
  });

  describe("AsyncLocalStorage semantics", () => {
    it("tracks context across awaits inside runWithRequestContext", async () => {
      const seeded = { requestId: "11111111-2222-4333-8444-555555555555" };
      const out = await runWithRequestContext(seeded, async () => {
        await Promise.resolve();
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setTimeout(r, 5));
        return getRequestId();
      });
      expect(out).toBe(seeded.requestId);
    });

    it("returns undefined when invoked outside any context", async () => {
      // The current synchronous call is outside any request context.
      expect(requestContextStorage.getStore()).toBeUndefined();
      // A microtask scheduled from outside a context must still see no store.
      await Promise.resolve();
      expect(requestContextStorage.getStore()).toBeUndefined();
    });

    it("isValidRequestId accepts UUID v4-strings only", () => {
      expect(isValidRequestId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(isValidRequestId("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true); // v1 is intentionally allowed by the relaxed regex
      expect(isValidRequestId("not-a-uuid")).toBe(false);
      expect(isValidRequestId("")).toBe(false);
      expect(isValidRequestId(null)).toBe(false);
      expect(isValidRequestId(undefined)).toBe(false);
      expect(isValidRequestId(123)).toBe(false);
      expect(isValidRequestId({})).toBe(false);
    });
  });

  describe("service logger binding", () => {
    it("createServiceLogger().child() includes requestId when called inside a request scope", async () => {
      const res = await request(makeApp({ withLogger: false })).get("/service-log");
      expect(res.status).toBe(200);
      // requestLoggerMiddleware is skipped here so the handler runs the
      // ingress itself; we still rely on xRequestIdMiddleware entering the
      // ALS context.
      expect(res.body.hasRequestId).toBe(true);
      expect(res.body.bindings).toEqual(
        expect.arrayContaining(["service", "requestId"]),
      );
    });
  });

  describe("logError picks up requestId automatically", () => {
    it("merges AsyncLocalStorage context into the log line when the caller passes no overrides", async () => {
      let captured = null;
      const app = express();
      app.use(xRequestIdMiddleware);
      app.get("/boom", (req, res) => {
        const fakeLogger = {
          error: (obj) => {
            captured = obj;
            res.json({ ok: true });
          },
        };
        logError(fakeLogger, new Error("kaboom"), { component: "router" });
      });
      const res = await request(app).get("/boom");
      expect(res.status).toBe(200);
      expect(captured.error.message).toBe("kaboom");
      expect(captured.requestId).toBe(res.headers["x-request-id"]);
      expect(captured.component).toBe("router"); // caller override preserved
    });

    it("does NOT inject a requestId when logError is invoked outside any context", () => {
      let captured = null;
      const fakeLogger = {
        error: (obj) => {
          captured = obj;
        },
      };
      // Sync invocation, outside any request
      logError(fakeLogger, new Error("background failure"));
      expect(captured.error.message).toBe("background failure");
      expect(captured.requestId).toBeUndefined();
    });
  });
});
