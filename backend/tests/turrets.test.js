const request = require("supertest");

jest.mock("@stellar/stellar-sdk", () => ({
  Server: jest.fn(() => ({
    submitTransaction: jest.fn(),
  })),
  Transaction: {
    fromXDR: jest.fn((_xdr) => ({
      sign: jest.fn(),
      toXDR: jest.fn(() => "SIGNED_XDR_MOCK"),
    })),
  },
}));

jest.mock("crypto", () => ({
  createSecretKey: jest.fn(() => ({ type: "secret" })),
}));

describe("Turrets API — POST /api/turrets/sign", () => {
  let app;

  beforeAll(async () => {
    process.env.ESCROW_SECRET_KEY =
      "a3c5f2d8e1b4c7a9f0e3d6b8c1a4f7e2d5b8c1a4f7e2d5b8c1a4f7e2d5b8c1a4";
    process.env.ALLOWED_ESCROW_PREFIX = "GC";
    process.env.STELLAR_NETWORK_PASSPHRASE =
      "Test SDF Network ; September 2015";

    const module = await import("../../src/server.js");
    app = module.default || module;
  });

  afterAll(() => {
    delete process.env.ESCROW_SECRET_KEY;
    delete process.env.ALLOWED_ESCROW_PREFIX;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when transactionXDR is missing", async () => {
    const res = await request(app)
      .post("/api/turrets/sign")
      .send({ escrowId: "GABC123" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when escrowId is missing", async () => {
    const res = await request(app)
      .post("/api/turrets/sign")
      .send({ transactionXDR: "AAAA" });
    expect(res.status).toBe(400);
  });

  it("returns 403 for unauthorized escrow ID prefix", async () => {
    const res = await request(app)
      .post("/api/turrets/sign")
      .send({
        transactionXDR: "AAAA",
        escrowId: "XUnauthorized123456789012345678901234567890123456789",
      });
    expect(res.status).toBe(403);
  });

  it("returns 500 when signing key is not configured", async () => {
    delete process.env.ESCROW_SECRET_KEY;
    const res = await request(app)
      .post("/api/turrets/sign")
      .send({
        transactionXDR: "AAAA",
        escrowId: "GABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890123456789",
      });
    expect(res.status).toBe(500);
    process.env.ESCROW_SECRET_KEY =
      "a3c5f2d8e1b4c7a9f0e3d6b8c1a4f7e2d5b8c1a4f7e2d5b8c1a4f7e2d5b8c1a4";
  });

  it("returns 200 with signed XDR for authorized escrow", async () => {
    const res = await request(app)
      .post("/api/turrets/sign")
      .send({
        transactionXDR: "AAAA",
        escrowId: "GABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890123456789",
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.signedXDR).toBeDefined();
    expect(res.body.data.escrowId).toBe(
      "GABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890123456789"
    );
  });
});