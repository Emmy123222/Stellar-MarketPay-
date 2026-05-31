"use strict";

const { createCorsOptions, getAllowedOrigins } = require("./cors");

function checkOrigin(options, origin) {
  return new Promise((resolve) => {
    options.origin(origin, (error, allowed) => {
      resolve({ error, allowed });
    });
  });
}

describe("CORS configuration", () => {
  it("denies cross-origin requests in production when ALLOWED_ORIGINS is unset", async () => {
    const logger = { warn: jest.fn() };
    const options = createCorsOptions({ env: { NODE_ENV: "production" }, logger });

    const result = await checkOrigin(options, "https://evil.example");

    expect(result.allowed).toBeUndefined();
    expect(result.error).toEqual(new Error("CORS blocked"));
    expect(logger.warn).toHaveBeenCalledWith(
      "ALLOWED_ORIGINS is not set; denying all cross-origin requests in production",
    );
  });

  it("allows localhost in development when ALLOWED_ORIGINS is unset", async () => {
    const options = createCorsOptions({ env: { NODE_ENV: "development" }, logger: { warn: jest.fn() } });

    await expect(checkOrigin(options, "http://localhost:3000")).resolves.toEqual({
      error: null,
      allowed: true,
    });
  });

  it("only allows configured origins in production", async () => {
    const options = createCorsOptions({
      env: { NODE_ENV: "production", ALLOWED_ORIGINS: "https://app.example, https://admin.example" },
      logger: { warn: jest.fn() },
    });

    await expect(checkOrigin(options, "https://app.example")).resolves.toEqual({
      error: null,
      allowed: true,
    });
    const rejected = await checkOrigin(options, "https://evil.example");
    expect(rejected.allowed).toBeUndefined();
    expect(rejected.error).toEqual(new Error("CORS blocked"));
  });

  it("parses configured origins and trims whitespace", () => {
    expect(getAllowedOrigins({ ALLOWED_ORIGINS: " https://app.example,https://admin.example " })).toEqual([
      "https://app.example",
      "https://admin.example",
    ]);
  });
});
