"use strict";

/**
 * backend/tests/metrics.test.js
 *
 * Prometheus observability tests.
 *
 * Verifies:
 *   - prom-client is installed and the shared registry is wired up.
 *   - All four required metrics are registered and exported:
 *       http_requests_total, http_request_duration_ms,
 *       active_websocket_connections, pool_query_duration_ms
 *   - `renderMetrics()` emits valid Prometheus text exposition format.
 *   - The `/metrics` internal-auth guard accepts a valid bearer token /
 *     internal IP and rejects everything else.
 *   - Monitoring config (prometheus.yml + Grafana dashboard) is present,
 *     parseable and references the exported metric names.
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");

const metrics = require("../src/metrics");
const metricsAuth = require("../src/middleware/metricsAuth");

const REQUIRED_METRICS = [
  "http_requests_total",
  "http_request_duration_ms",
  "active_websocket_connections",
  "pool_query_duration_ms",
];

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MONITORING = path.join(REPO_ROOT, "monitoring");

describe("Prometheus metrics", () => {
  describe("prom-client dependency", () => {
    it("is declared in backend package.json dependencies", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
      );
      expect(pkg.dependencies).toHaveProperty("prom-client");
    });

    it("is resolvable at runtime", () => {
      expect(() => require("prom-client")).not.toThrow();
    });
  });

  describe("registry", () => {
    it("exposes a prom-client Registry with the text content type", () => {
      expect(metrics.registry).toBeDefined();
      expect(typeof metrics.registry.metrics).toBe("function");
      expect(metrics.registry.contentType).toContain("text/plain");
    });

    it("collects Node.js default metrics under the marketpay_ prefix", async () => {
      const output = await metrics.renderMetrics();
      expect(output).toContain("marketpay_process_cpu_user_seconds_total");
    });
  });

  describe.each(REQUIRED_METRICS)("required metric %s", (name) => {
    it("is registered on the shared registry", () => {
      expect(metrics.registry.getSingleMetric(name)).toBeTruthy();
    });

    it("appears in the rendered exposition output", async () => {
      const output = await metrics.renderMetrics();
      expect(output).toContain(`# HELP ${name}`);
      expect(output).toContain(`# TYPE ${name}`);
    });
  });

  describe("exposition format", () => {
    it("emits parseable Prometheus text format", async () => {
      const output = await metrics.renderMetrics();
      const lines = output.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        // Every line is a comment or `name{labels} value [timestamp]`.
        expect(line.startsWith("#") || /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{.*\})?\s+\S+/.test(line)).toBe(true);
      }
    });
  });

  describe("observeHttpRequest", () => {
    it("increments the counter and the histogram together", async () => {
      const labels = { method: "GET", route: "/__test__/http", status_code: "200" };
      metrics.observeHttpRequest(labels, 42);

      const counter = await metrics.httpRequestsTotal.get();
      const sample = counter.values.find((v) => v.labels.route === "/__test__/http");
      expect(sample).toBeTruthy();
      expect(sample.value).toBeGreaterThanOrEqual(1);

      const hist = await metrics.httpRequestDurationMs.get();
      const sum = hist.values.find(
        (v) => v.metricName === "http_request_duration_ms_sum" && v.labels.route === "/__test__/http"
      );
      expect(sum).toBeTruthy();
      expect(sum.value).toBeCloseTo(42, 3);
    });

    it("also feeds the legacy marketpay_* series in seconds", async () => {
      metrics.observeHttpRequest(
        { method: "GET", route: "/__test__/legacy", status_code: "200" },
        2000
      );
      const hist = await metrics.legacyHttpRequestDurationSeconds.get();
      const sum = hist.values.find(
        (v) =>
          v.metricName === "marketpay_http_request_duration_seconds_sum" &&
          v.labels.route === "/__test__/legacy"
      );
      expect(sum.value).toBeCloseTo(2, 3);
    });
  });

  describe("observePoolQuery", () => {
    it("records duration and count under the operation label", async () => {
      metrics.observePoolQuery("select", "success", 12.5);

      const hist = await metrics.poolQueryDurationMs.get();
      const sum = hist.values.find(
        (v) =>
          v.metricName === "pool_query_duration_ms_sum" &&
          v.labels.operation === "select" &&
          v.labels.status === "success"
      );
      expect(sum).toBeTruthy();
      expect(sum.value).toBeGreaterThanOrEqual(12.5);
    });

    it("labels failures with status=error", async () => {
      metrics.observePoolQuery("insert", "error", 3);
      const counter = await metrics.poolQueriesTotal.get();
      const sample = counter.values.find(
        (v) => v.labels.operation === "insert" && v.labels.status === "error"
      );
      expect(sample).toBeTruthy();
    });
  });

  describe("sqlOperation", () => {
    it.each([
      ["SELECT * FROM jobs", "select"],
      ["  insert into jobs values (1)", "insert"],
      ["UPDATE jobs SET x = 1", "update"],
      ["DELETE FROM jobs", "delete"],
      ["WITH cte AS (SELECT 1) SELECT * FROM cte", "with"],
      ["BEGIN", "begin"],
    ])("maps %s to %s", (sql, expected) => {
      expect(metrics.sqlOperation(sql)).toBe(expected);
    });

    it("accepts a pg query config object", () => {
      expect(metrics.sqlOperation({ text: "SELECT 1" })).toBe("select");
    });

    it("returns 'other' for unrecognised or non-string input", () => {
      expect(metrics.sqlOperation(null)).toBe("other");
      expect(metrics.sqlOperation(123)).toBe("other");
      expect(metrics.sqlOperation("VACUUM ANALYZE")).toBe("other");
    });

    it("never embeds query parameters in the label (bounded cardinality)", () => {
      const op = metrics.sqlOperation("SELECT * FROM users WHERE email = 'a@b.c'");
      expect(op).toBe("select");
      expect(op).not.toContain("@");
    });
  });

  describe("normalizeRoutePath", () => {
    it.each([
      ["/api/jobs/8123", "/api/jobs/:id"],
      ["/api/jobs/8123/bids", "/api/jobs/:id/bids"],
      ["/api/disputes/3fa85f64-5717-4562-b3fc-2c963f66afa6", "/api/disputes/:id"],
      ["/api/profiles/GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV", "/api/profiles/:id"],
      ["/api/jobs", "/api/jobs"],
      ["/api/jobs?status=open", "/api/jobs"],
      ["/", "/"],
      ["", "/"],
    ])("normalises %s to %s", (input, expected) => {
      expect(metrics.normalizeRoutePath(input)).toBe(expected);
    });

    it("bounds cardinality across many distinct ids", () => {
      const labels = new Set();
      for (let i = 0; i < 500; i += 1) {
        labels.add(metrics.normalizeRoutePath(`/api/jobs/${i}`));
      }
      expect(labels.size).toBe(1);
    });

    it("caps pathologically long segments", () => {
      expect(metrics.normalizeRoutePath(`/api/${"a".repeat(200)}`)).toBe("/api/:id");
    });

    it("handles malformed percent-encoding without throwing", () => {
      expect(() => metrics.normalizeRoutePath("/api/%E0%A4%A")).not.toThrow();
    });
  });

  describe("resolveRouteLabel", () => {
    it("prefers the matched Express pattern", () => {
      expect(metrics.resolveRouteLabel("/api/jobs/:id", "/api/jobs/8123")).toBe("/api/jobs/:id");
    });

    it("falls back to the normalised URL when the pattern lost its mount prefix", () => {
      // Express restores req.baseUrl to "" before error handlers respond, so a
      // bare ":id" pattern must not become the label.
      expect(metrics.resolveRouteLabel("/:id", "/api/jobs/8123")).toBe("/api/jobs/:id");
    });

    it("falls back to the normalised URL when no pattern matched (404)", () => {
      expect(metrics.resolveRouteLabel(null, "/nope")).toBe("/nope");
    });
  });

  describe("setWebsocketConnections", () => {
    it("sets the gauge per channel", async () => {
      metrics.setWebsocketConnections("realtime", 7);
      metrics.setWebsocketConnections("scope", 3);

      const gauge = await metrics.activeWebsocketConnections.get();
      const realtime = gauge.values.find((v) => v.labels.channel === "realtime");
      const scope = gauge.values.find((v) => v.labels.channel === "scope");
      expect(realtime.value).toBe(7);
      expect(scope.value).toBe(3);
    });

    it("mirrors the realtime channel to the legacy gauge", async () => {
      metrics.setWebsocketConnections("realtime", 11);
      const legacy = await metrics.legacyWsConnectionsActive.get();
      expect(legacy.values[0].value).toBe(11);
    });
  });
});

describe("GET /metrics internal auth", () => {
  const ORIGINAL_ENV = { ...process.env };

  /**
   * Build a minimal Express app that mounts the real metrics route.
   *
   * @returns {import("express").Express} configured app
   */
  function buildApp() {
    const app = express();
    app.get("/metrics", metricsAuth, async (req, res) => {
      res.set("Content-Type", metrics.registry.contentType);
      res.end(await metrics.renderMetrics());
    });
    return app;
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows loopback scrapes when private-network access is enabled", async () => {
    delete process.env.METRICS_TOKEN;
    delete process.env.METRICS_SECRET;
    const res = await request(buildApp()).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("http_requests_total");
  });

  it("accepts a valid bearer token", async () => {
    process.env.METRICS_TOKEN = "super-secret-scrape-token";
    const res = await request(buildApp())
      .get("/metrics")
      .set("Authorization", "Bearer super-secret-scrape-token");
    expect(res.status).toBe(200);
  });

  it("accepts the X-Metrics-Token header", async () => {
    process.env.METRICS_TOKEN = "super-secret-scrape-token";
    const res = await request(buildApp())
      .get("/metrics")
      .set("X-Metrics-Token", "super-secret-scrape-token");
    expect(res.status).toBe(200);
  });

  it("rejects an invalid bearer token with 401", async () => {
    process.env.METRICS_TOKEN = "super-secret-scrape-token";
    const res = await request(buildApp())
      .get("/metrics")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });

  it("rejects tokens of a different length without throwing", async () => {
    process.env.METRICS_TOKEN = "super-secret-scrape-token";
    const res = await request(buildApp())
      .get("/metrics")
      .set("Authorization", "Bearer x");
    expect(res.status).toBe(401);
  });

  it("requires a token when private-network access is disabled", async () => {
    process.env.METRICS_TOKEN = "super-secret-scrape-token";
    process.env.METRICS_ALLOW_PRIVATE_NETWORK = "false";
    const denied = await request(buildApp()).get("/metrics");
    expect(denied.status).toBe(401);

    const allowed = await request(buildApp())
      .get("/metrics")
      .set("Authorization", "Bearer super-secret-scrape-token");
    expect(allowed.status).toBe(200);
  });

  it("still honours the legacy METRICS_SECRET env name", async () => {
    delete process.env.METRICS_TOKEN;
    process.env.METRICS_SECRET = "legacy-secret";
    const res = await request(buildApp())
      .get("/metrics")
      .set("Authorization", "Bearer legacy-secret");
    expect(res.status).toBe(200);
  });

  it("never responds 403 (so the CSRF bypass contract holds)", async () => {
    process.env.METRICS_TOKEN = "t";
    const res = await request(buildApp())
      .get("/metrics")
      .set("Authorization", "Bearer nope");
    expect(res.status).not.toBe(403);
  });

  describe("isInternalIp", () => {
    it.each(["127.0.0.1", "::1", "10.1.2.3", "192.168.0.7", "172.16.5.9", "172.31.0.1", "fd00::1"])(
      "treats %s as internal",
      (ip) => expect(metricsAuth.isInternalIp(ip)).toBe(true)
    );

    it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "203.0.113.5", "2606:4700::1", ""])(
      "treats %s as external",
      (ip) => expect(metricsAuth.isInternalIp(ip)).toBe(false)
    );

    it("normalises IPv4-mapped IPv6 addresses", () => {
      expect(metricsAuth.isInternalIp("::ffff:10.0.0.5")).toBe(true);
      expect(metricsAuth.isInternalIp("::ffff:8.8.8.8")).toBe(false);
    });
  });
});

describe("monitoring configuration", () => {
  describe("prometheus.yml", () => {
    const file = path.join(MONITORING, "prometheus", "prometheus.yml");

    it("exists", () => {
      expect(fs.existsSync(file)).toBe(true);
    });

    it("defines a marketpay-backend scrape job on /metrics", () => {
      const raw = fs.readFileSync(file, "utf8");
      expect(raw).toContain("job_name: marketpay-backend");
      expect(raw).toContain("metrics_path: /metrics");
      expect(raw).toContain("backend:4000");
    });

    it("documents how to enable bearer-token scraping", () => {
      const raw = fs.readFileSync(file, "utf8");
      expect(raw).toMatch(/METRICS_TOKEN/);
    });
  });

  describe("alert rules", () => {
    const file = path.join(MONITORING, "prometheus", "rules", "alerts.yml");

    it("alerts on the new metric names", () => {
      const raw = fs.readFileSync(file, "utf8");
      expect(raw).toContain("http_request_duration_ms_bucket");
      expect(raw).toContain("pool_query_duration_ms_bucket");
      expect(raw).toContain("active_websocket_connections");
    });
  });

  describe("Grafana dashboard", () => {
    const file = path.join(MONITORING, "grafana", "dashboards", "marketpay-backend-metrics.json");

    it("exists and is valid JSON", () => {
      expect(fs.existsSync(file)).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
    });

    it("has the required dashboard fields", () => {
      const dash = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(typeof dash.uid).toBe("string");
      expect(typeof dash.title).toBe("string");
      expect(Array.isArray(dash.panels)).toBe(true);
      expect(dash.panels.length).toBeGreaterThan(0);
      expect(typeof dash.schemaVersion).toBe("number");
    });

    it("gives every panel a unique id and a grid position", () => {
      const dash = JSON.parse(fs.readFileSync(file, "utf8"));
      const ids = dash.panels.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const panel of dash.panels) {
        expect(panel.gridPos).toBeDefined();
        expect(typeof panel.gridPos.w).toBe("number");
      }
    });

    it("charts all four required metrics", () => {
      const raw = fs.readFileSync(file, "utf8");
      for (const name of REQUIRED_METRICS) {
        expect(raw).toContain(name);
      }
    });

    it("is picked up by the dashboards provisioning path", () => {
      const provisioning = fs.readFileSync(
        path.join(MONITORING, "grafana", "provisioning", "dashboards", "dashboards.yml"),
        "utf8"
      );
      expect(provisioning).toContain("/var/lib/grafana/dashboards");
    });
  });
});
