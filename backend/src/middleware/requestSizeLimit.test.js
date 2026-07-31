"use strict";

const { sanitizeMiddleware } = require("./sanitize");
const { createRequestSizeLimitMiddleware } = require("./requestSizeLimit");

describe("request body size limit and sanitization middleware", () => {
  it("rejects oversized request bodies with 413 when content-length exceeds the configured limit", () => {
    const middleware = createRequestSizeLimitMiddleware("1kb");
    const next = jest.fn();

    middleware(
      { headers: { "content-length": "1500" } },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 413,
        message: expect.stringContaining("Request body too large"),
      }),
    );
  });

  it("strips HTML tags from nested string inputs", () => {
    const middleware = sanitizeMiddleware();
    const req = {
      body: {
        proposal: '<script>alert("xss")</script>Hello <b>world</b>',
        profile: {
          bio: '<img src=x onerror="alert(1)">Builder',
        },
      },
      query: {},
      params: {},
    };
    const next = jest.fn();

    middleware(req, {}, next);

    expect(req.body.proposal).toBe("Hello world");
    expect(req.body.profile.bio).toBe("Builder");
    expect(next).toHaveBeenCalledWith();
  });
});
