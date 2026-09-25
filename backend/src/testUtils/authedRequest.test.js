"use strict";

const cookieParser = require("cookie-parser");
const express = require("express");
const request = require("supertest");
const {
  doubleCsrfProtection,
  generateCsrfToken,
} = require("../middleware/csrf");
const { authedAgent } = require("./authedRequest");

describe("authedAgent", () => {
  it("keeps the CSRF cookie and echoes its body token on mutations", async () => {
    const app = express();
    app.use(cookieParser());
    app.get("/api/auth/csrf-token", (req, res) => {
      res.json({ csrfToken: generateCsrfToken(req, res) });
    });
    app.use(doubleCsrfProtection);
    app.post("/mutating", (req, res) => res.sendStatus(204));

    const agent = await authedAgent(app, {
      publicKey: "G" + "A".repeat(55),
    });
    const response = await agent.post("/mutating");

    expect(response.status).toBe(204);
  });

  it("uses an explicitly supplied bearer token", async () => {
    const app = express();
    app.get("/echo", (req, res) =>
      res.json({ authorization: req.headers.authorization }),
    );

    const agent = await authedAgent(app, { token: "not-a-real-jwt" });
    const response = await agent.get("/echo");

    expect(response.body.authorization).toBe("Bearer not-a-real-jwt");
  });

  it("does not bootstrap CSRF for minimal apps when csrf is disabled", async () => {
    const app = express();
    app.post("/mutating", (req, res) => res.sendStatus(204));

    const agent = await authedAgent(app, { csrf: false });
    const response = await agent.post("/mutating");

    expect(response.status).toBe(204);
  });

  it("retains supertest agent behavior for ordinary requests", async () => {
    const app = express();
    app.get("/health", (req, res) => res.sendStatus(200));

    const agent = await authedAgent(app);
    await request(app).get("/health").expect(200);
    await agent.get("/health").expect(200);
  });
});