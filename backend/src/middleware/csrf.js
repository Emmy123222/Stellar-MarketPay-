"use strict";

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const name = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function verifyCSRF(req, res, next) {
  // Safe methods do not require CSRF protection
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Exempt auth routes and health checks
  if (req.path.startsWith("/api/auth") || req.path === "/health" || req.path.startsWith("/health/")) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies["XSRF-TOKEN"];
  const headerToken = req.headers["x-xsrf-token"];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "Forbidden: CSRF token mismatch" });
  }

  next();
}

module.exports = { verifyCSRF };
