"use strict";

const express = require("express");
const compressionMiddleware = require("./compression");
const request = require("supertest");

describe("compression middleware", () => {
  it("returns br-encoded responses when Accept-Encoding includes br", async () => {
    const app = express();
    app.use(compressionMiddleware());
    app.get("/api/jobs", (req, res) => {
      res.json({
        jobs: Array.from({ length: 50 }, (_, i) => ({
          id: `job-${i}`,
          title: `Sample job listing ${i}`,
          description: "A".repeat(200),
        })),
      });
    });

    const res = await request(app)
      .get("/api/jobs")
      .set("Accept-Encoding", "br");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
  });

  it("returns gzip-encoded responses when Accept-Encoding includes gzip but not br", async () => {
    const app = express();
    app.use(compressionMiddleware());
    app.get("/api/jobs", (req, res) => {
      res.json({
        jobs: Array.from({ length: 50 }, (_, i) => ({
          id: `job-${i}`,
          title: `Sample job listing ${i}`,
          description: "A".repeat(200),
        })),
      });
    });

    const res = await request(app)
      .get("/api/jobs")
      .set("Accept-Encoding", "gzip");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("returns valid JSON when compression is not requested", async () => {
    const app = express();
    app.use(compressionMiddleware());
    app.get("/api/jobs", (req, res) => {
      res.json({ jobs: [{ id: "job-1", title: "Test job" }] });
    });

    const res = await request(app).get("/api/jobs");

    expect(res.status).toBe(200);
    // Payload is small (< 1KB), so it shouldn't compress anyway
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].title).toBe("Test job");
  });
});
