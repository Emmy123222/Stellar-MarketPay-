const request = require("supertest");

/**
 * Helper to fetch a valid CSRF token and cookie for use in test requests.
 * @param {Object} app The Express application instance
 * @returns {Promise<{cookie: string, csrfToken: string}>}
 */
async function getCsrfToken(app) {
  const res = await request(app).get("/api/auth/csrf-token");
  
  if (!res.headers["set-cookie"]) {
    throw new Error("No cookies returned from /api/auth/csrf-token");
  }

  const cookie = res.headers["set-cookie"].find(c => c.startsWith("csrf-token="));
  if (!cookie) {
    throw new Error("No csrf-token cookie found in response");
  }

  return {
    cookie,
    csrfToken: res.body.csrfToken,
  };
}

module.exports = {
  getCsrfToken,
};
