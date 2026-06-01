"use strict";

const { Server } = require("@stellar/stellar-sdk");

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const CACHE_TTL_MS = 30_000;

const cache = new Map();
const inFlight = new Map();

function getServer() {
  return new Server(HORIZON_URL);
}

async function getAccount(publicKey) {
  if (!publicKey) {
    const e = new Error("Public key is required");
    e.status = 400;
    throw e;
  }

  const now = Date.now();
  const cached = cache.get(publicKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  if (inFlight.has(publicKey)) {
    return inFlight.get(publicKey);
  }

  const promise = (async () => {
    try {
      const server = getServer();
      const account = await server.loadAccount(publicKey);
      cache.set(publicKey, { data: account, timestamp: Date.now() });
      return account;
    } finally {
      inFlight.delete(publicKey);
    }
  })();

  inFlight.set(publicKey, promise);
  return promise;
}

function invalidate(publicKey) {
  cache.delete(publicKey);
}

function invalidateAll() {
  cache.clear();
}

function getCacheSize() {
  return cache.size;
}

module.exports = {
  getAccount,
  invalidate,
  invalidateAll,
  getCacheSize,
  CACHE_TTL_MS,
};
