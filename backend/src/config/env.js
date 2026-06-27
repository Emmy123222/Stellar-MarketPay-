"use strict";

function requireEnv(name, { fallback } = {}) {
  const value = process.env[name] ?? fallback;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value.trim();
}

function requireChoice(name, allowedValues, { fallback } = {}) {
  const value = requireEnv(name, { fallback });
  if (!allowedValues.includes(value)) {
    throw new Error(
      `${name} must be one of: ${allowedValues.join(", ")}`,
    );
  }
  return value;
}

module.exports = { requireEnv, requireChoice };
