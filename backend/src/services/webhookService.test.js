"use strict";

const mockQuery = jest.fn();
const mockPost = jest.fn();

jest.mock("../db/pool", () => ({
  query: (...args) => mockQuery(...args),
}));

jest.mock("axios", () => ({
  post: (...args) => mockPost(...args),
}));

const {
  buildSignature,
  registerWebhook,
  deliverSingleWebhook,
  deliverEscrowWebhooks,
} = require("./webhookService");

describe("webhookService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockPost.mockReset();
  });

  it("registers a webhook", async () => {
    const row = {
      id: "webhook-1",
      user_address: "GTEST",
      url: "https://example.com/webhook",
      events: ["escrow_released"],
      created_at: new Date().toISOString(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await registerWebhook({
      userAddress: "GTEST",
      url: row.url,
      events: row.events,
      secret: "supersecret",
    });

    expect(result).toEqual(row);
  });

  it("builds a deterministic HMAC-SHA256 signature", () => {
    const signature = buildSignature("secret", JSON.stringify({ hello: "world" }));
    expect(signature).toHaveLength(64);
    expect(signature).toMatch(/^[a-f0-9]+$/);
  });

  it("retries failed deliveries and records each attempt", async () => {
    mockPost
      .mockRejectedValueOnce(new Error("network 1"))
      .mockRejectedValueOnce(new Error("network 2"))
      .mockResolvedValueOnce({ status: 202 });
    mockQuery.mockResolvedValue({ rows: [{}] });

    const result = await deliverSingleWebhook(
      {
        id: "webhook-1",
        url: "https://example.com/webhook",
        secret: "supersecret",
      },
      "escrow_released",
      { event: "escrow_released", jobId: "job-1" },
    );

    expect(result.success).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("delivers escrow events to subscribed webhooks", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "webhook-1",
            user_address: "GTEST",
            url: "https://example.com/webhook",
            events: ["escrow_released"],
            secret: "supersecret",
          },
        ],
      })
      .mockResolvedValue({ rows: [{}] });
    mockPost.mockResolvedValue({ status: 200 });

    const result = await deliverEscrowWebhooks({
      eventType: "escrow_released",
      userAddresses: ["GTEST"],
      payload: { event: "escrow_released", jobId: "job-1" },
    });

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0].success).toBe(true);
  });
});
