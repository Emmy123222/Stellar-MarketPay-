"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const { requireAdminRole } = require("./auth");

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("JWT secret configuration", () => {
  it("exits with a fatal error when JWT_SECRET is missing", () => {
    const authModule = path.join(__dirname, "auth.js");
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/marketpay_test",
      NODE_ENV: "production",
    };
    delete env.JWT_SECRET;

    const result = spawnSync(
      process.execPath,
      ["-e", `require(${JSON.stringify(authModule)})`],
      { env, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FATAL: JWT_SECRET environment variable is required");
  });
});

describe("requireAdminRole", () => {
  afterEach(() => {
    delete process.env.ADMIN_WALLET_ADDRESSES;
  });

  it("allows a verified JWT with an admin role", () => {
    const req = { user: { publicKey: "GADMIN", role: "admin" } };
    const res = createMockResponse();
    const next = jest.fn();

    requireAdminRole(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a non-admin JWT even when the public key is listed as an admin address", () => {
    process.env.ADMIN_WALLET_ADDRESSES = "GADMIN";
    const req = { user: { publicKey: "GADMIN", role: "user" } };
    const res = createMockResponse();
    const next = jest.fn();

    requireAdminRole(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Forbidden: Admin access required" });
  });

  it("rejects requests without a verified user", () => {
    const req = {};
    const res = createMockResponse();
    const next = jest.fn();

    requireAdminRole(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});
