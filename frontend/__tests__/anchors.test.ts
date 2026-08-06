/**
 * __tests__/anchors.test.ts
 * Unit tests for lib/anchors.ts — SEP-0001 / SEP-0010 / SEP-0024 / SEP-0031
 * Issue #861 — Stellar SEP-24 fiat on/off-ramp
 *
 * Covers: TOML discovery, anchor auth (SEP-10), interactive deposit/withdraw
 * (SEP-24), cross-border send (SEP-31), transaction polling, and terminal
 * statuses. Happy paths + failure paths: anchor/auth timeout, JWT expiry
 * mid-poll, user closing popup (cancellation), network failure during polling.
 *
 * Cache isolation: each test uses a unique homeDomain or account so that
 * module-level Maps (tomlCache, tokenCache) never collide across tests.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

import {
  ANCHOR_HOME_DOMAIN,
  ANCHOR_TERMINAL_STATUSES,
  clearAnchorCaches,
  fetchAnchorEndpoints,
  getAnchorJwt,
  startInteractiveDeposit,
  startInteractiveWithdraw,
  fetchAnchorTransaction,
  pollAnchorTransaction,
  fetchSep31Info,
  initiateSep31Send,
} from "@/lib/anchors";
import { signTransactionWithWallet } from "@/lib/wallet";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOML_TEXT = `
WEB_AUTH_ENDPOINT="https://testanchor.stellar.org/auth"
TRANSFER_SERVER_SEP0024="https://testanchor.stellar.org/sep24"
DIRECT_PAYMENT_SERVER="https://testanchor.stellar.org/sep31"
SIGNING_KEY="GBBHMSU3XU4KSYQE3POCCFGS6DEQ5VAIVAYD4RFB5EWCKS7PV67CGXVC"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

[[CURRENCIES]]
code="XLM"
issuer=""

[[CURRENCIES]]
code="USDC"
issuer="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
`;

const TOML_MINIMAL = `
WEB_AUTH_ENDPOINT="https://minimal.example/auth"
TRANSFER_SERVER="https://minimal.example/sep24"
`;

const CHALLENGE_XDR = "AAAAAFakeChallengeTransactionXDRBase64Encoded==";
const SIGNED_XDR = "AAAAAFakeSignedTransactionXDRBase64Encoded==";
const ANCHOR_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJHQVNDRkciLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTgwMDAwMDAwMH0.fake";

function makeTomlResponse(text: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

function makeJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeInteractiveTxResponse(id = "tx-abc", url = "https://anchor.example/interactive/abc") {
  return makeJsonResponse({ type: "interactive_customer_info_needed", url, id });
}

function makeTransactionRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "tx-abc",
    kind: "deposit",
    status: "pending_user_transfer_start",
    amount_in: "100",
    amount_out: "99.5",
    amount_fee: "0.5",
    started_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSep31InfoResponse() {
  return makeJsonResponse({
    receive: {
      USD: { enabled: true, min_amount: 10, max_amount: 5000, sep12: {} },
      EUR: { enabled: false, sep12: {} },
    },
  });
}

function makeSep31SendResponse() {
  return makeJsonResponse({
    id: "sep31-tx-abc",
    stellar_account_id: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890A",
    stellar_memo: "123456",
    stellar_memo_type: "text",
  });
}

const TEST_ACCOUNT = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890A";

// ---------------------------------------------------------------------------
// SEP-0001 — TOML Discovery (fetchAnchorEndpoints)
// ---------------------------------------------------------------------------

describe("fetchAnchorEndpoints — SEP-0001 TOML discovery", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAnchorCaches();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("parses WEB_AUTH_ENDPOINT, TRANSFER_SERVER_SEP0024, DIRECT_PAYMENT_SERVER, SIGNING_KEY", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(TOML_TEXT));

    const endpoints = await fetchAnchorEndpoints("testanchor.stellar.org");

    expect(endpoints.webAuthEndpoint).toBe("https://testanchor.stellar.org/auth");
    expect(endpoints.transferServerSep24).toBe("https://testanchor.stellar.org/sep24");
    expect(endpoints.directPaymentServer).toBe("https://testanchor.stellar.org/sep31");
    expect(endpoints.signingKey).toBe("GBBHMSU3XU4KSYQE3POCCFGS6DEQ5VAIVAYD4RFB5EWCKS7PV67CGXVC");
    expect(endpoints.homeDomain).toBe("testanchor.stellar.org");
  });

  it("parses [[CURRENCIES]] blocks into code/issuer pairs", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(TOML_TEXT));

    const endpoints = await fetchAnchorEndpoints("testanchor.stellar.org");

    expect(endpoints.currencies).toHaveLength(2);
    expect(endpoints.currencies[0]).toEqual({ code: "XLM", issuer: "" });
    expect(endpoints.currencies[1]).toEqual({
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });
  });

  it("falls back to TRANSFER_SERVER when TRANSFER_SERVER_SEP0024 is absent", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(TOML_MINIMAL));

    const endpoints = await fetchAnchorEndpoints("minimal.example");

    expect(endpoints.transferServerSep24).toBe("https://minimal.example/sep24");
  });

  it("throws when homeDomain is empty", async () => {
    global.fetch = jest.fn();

    await expect(fetchAnchorEndpoints("")).rejects.toThrow("No anchor configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws on HTTP error from TOML fetch", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeTomlResponse("Not Found", 404));

    await expect(fetchAnchorEndpoints("bad.anchor")).rejects.toThrow("Could not fetch anchor TOML (404)");
  });

  it("throws on network failure during TOML fetch", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(fetchAnchorEndpoints("offline.anchor")).rejects.toThrow("ECONNREFUSED");
  });

  it("throws when WEB_AUTH_ENDPOINT is missing from TOML", async () => {
    const noAuthToml = `TRANSFER_SERVER="https://example.com/sep24"`;
    global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(noAuthToml));

    await expect(fetchAnchorEndpoints("no-auth.anchor")).rejects.toThrow(
      "Anchor TOML is missing WEB_AUTH_ENDPOINT",
    );
  });

  it("caches TOML results — second call does not re-fetch", async () => {
    global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(TOML_TEXT));

    await fetchAnchorEndpoints("cache-test.anchor");
    await fetchAnchorEndpoints("cache-test.anchor");

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// SEP-0010 — Anchor Web Authentication (getAnchorJwt)
//
// Each test uses a unique account / homeDomain pair so the module-level
// tokenCache never collides across tests.
// ---------------------------------------------------------------------------

describe("getAnchorJwt — SEP-0010 anchor auth", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAnchorCaches();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("completes the full challenge→sign→JWT flow", async () => {
    const account = TEST_ACCOUNT + "01";
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT)) // TOML
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR })) // GET challenge
      .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT })); // POST signed tx

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const jwt = await getAnchorJwt("testanchor.stellar.org", account);

    expect(jwt).toBe(ANCHOR_JWT);

    const challengeCallUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(challengeCallUrl).toContain(`account=${account}`);
    expect(challengeCallUrl).toContain("home_domain=testanchor.stellar.org");

    const postBody = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body);
    expect(postBody.transaction).toBe(SIGNED_XDR);
  });

  it("caches JWT for subsequent calls within TTL", async () => {
    const account = TEST_ACCOUNT + "02";
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
      .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }));

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const jwt1 = await getAnchorJwt("cache-test.anchor", account);
    const jwt2 = await getAnchorJwt("cache-test.anchor", account);

    expect(jwt1).toBe(ANCHOR_JWT);
    expect(jwt2).toBe(ANCHOR_JWT);
    // Only 1 TOML + 1 challenge + 1 verify = 3 fetches, not 6
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("throws when anchor challenge endpoint returns HTTP error (anchor timeout)", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeTomlResponse("Gateway Timeout", 504));

    await expect(getAnchorJwt("timeout.anchor", TEST_ACCOUNT + "03")).rejects.toThrow(
      "Anchor auth challenge failed (504)",
    );
  });

  it("throws when anchor challenge returns no transaction", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: "" }));

    await expect(getAnchorJwt("no-tx.anchor", TEST_ACCOUNT + "04")).rejects.toThrow(
      "Anchor did not return a challenge transaction",
    );
  });

  it("throws when wallet signing is cancelled by user", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }));

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({
      signedXDR: null,
      error: "Transaction signing rejected.",
    });

    await expect(getAnchorJwt("reject.anchor", TEST_ACCOUNT + "05")).rejects.toThrow(
      "Transaction signing rejected.",
    );
  });

  it("throws when anchor JWT exchange returns non-OK", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
      .mockResolvedValueOnce(makeTomlResponse("Forbidden", 403));

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    await expect(getAnchorJwt("forbidden.anchor", TEST_ACCOUNT + "06")).rejects.toThrow(
      "Anchor JWT exchange failed (403)",
    );
  });

  it("throws when anchor JWT response contains no token", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
      .mockResolvedValueOnce(makeJsonResponse({ token: "" }));

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    await expect(getAnchorJwt("empty.anchor", TEST_ACCOUNT + "07")).rejects.toThrow(
      "Anchor did not return a JWT",
    );
  });
});

// ---------------------------------------------------------------------------
// SEP-0024 — Interactive Deposit / Withdraw
// ---------------------------------------------------------------------------

describe("SEP-0024 interactive flows", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAnchorCaches();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("startInteractiveDeposit", () => {
    it("returns { type, url, id } on success", async () => {
      const mockResponse = makeInteractiveTxResponse("dep-123", "https://anchor.example/deposit/123");
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
        .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
        .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
        .mockResolvedValueOnce(mockResponse);

      (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

      const result = await startInteractiveDeposit({ account: TEST_ACCOUNT, assetCode: "USDC" });

      expect(result.id).toBe("dep-123");
      expect(result.url).toBe("https://anchor.example/deposit/123");
      expect(result.type).toBe("interactive_customer_info_needed");
    });

    it("throws when anchor has no TRANSFER_SERVER", async () => {
      const noTransferToml = `WEB_AUTH_ENDPOINT="https://example.com/auth"`;
      global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(noTransferToml));

      await expect(
        startInteractiveDeposit({ homeDomain: "no-transfer.example", account: TEST_ACCOUNT, assetCode: "XLM" }),
      ).rejects.toThrow("This anchor does not support SEP-0024");
    });

    it("throws when SEP-24 POST returns non-OK (400 bad request)", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
        .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
        .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
        .mockResolvedValueOnce(makeJsonResponse({ error: "unsupported_asset_code" }, 400));

      (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

      await expect(
        startInteractiveDeposit({ account: TEST_ACCOUNT, assetCode: "INVALID" }),
      ).rejects.toThrow("Anchor deposit request failed (400)");
    });
  });

  describe("startInteractiveWithdraw", () => {
    it("calls /transactions/withdraw/interactive with correct params", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
        .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
        .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
        .mockResolvedValueOnce(makeInteractiveTxResponse("wdr-456", "https://anchor.example/withdraw/456"));

      (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

      const result = await startInteractiveWithdraw({ account: TEST_ACCOUNT, assetCode: "USDC", lang: "es" });

      expect(result.id).toBe("wdr-456");
      expect(result.type).toBe("interactive_customer_info_needed");

      const sep24CallUrl = (global.fetch as jest.Mock).mock.calls[3][0] as string;
      expect(sep24CallUrl).toContain("/withdraw/interactive");

      const body = (global.fetch as jest.Mock).mock.calls[3][1].body as string;
      expect(body).toContain("asset_code=USDC");
      expect(body).toContain(`account=${TEST_ACCOUNT}`);
      expect(body).toContain("lang=es");
    });
  });
});

// ---------------------------------------------------------------------------
// fetchAnchorTransaction — Single transaction lookup
// ---------------------------------------------------------------------------

describe("fetchAnchorTransaction", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAnchorCaches();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the transaction record on success", async () => {
    const txRecord = makeTransactionRecord({ id: "tx-lookup", status: "completed" });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
      .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: txRecord }));

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const result = await fetchAnchorTransaction({ account: TEST_ACCOUNT, id: "tx-lookup" });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("tx-lookup");
    expect(result!.status).toBe("completed");
  });

  it("returns null when anchor has no transfer server", async () => {
    const noTransferToml = `WEB_AUTH_ENDPOINT="https://example.com/auth"`;
    global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(noTransferToml));

    const result = await fetchAnchorTransaction({
      homeDomain: "no-transfer.example",
      account: TEST_ACCOUNT,
      id: "tx-1",
    });

    expect(result).toBeNull();
  });

  it("returns null on non-OK HTTP response", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
      .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
      .mockResolvedValueOnce(makeTomlResponse("Not Found", 404));

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const result = await fetchAnchorTransaction({ account: TEST_ACCOUNT, id: "missing-tx" });

    expect(result).toBeNull();
  });

  it("returns null on network failure", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
      .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
      .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
      .mockRejectedValueOnce(new Error("ECONNRESET"));

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const result = await fetchAnchorTransaction({ account: TEST_ACCOUNT, id: "tx-netfail" });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pollAnchorTransaction — Polling with interval, timeout, cancellation
// ---------------------------------------------------------------------------

describe("pollAnchorTransaction", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAnchorCaches();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  function setupPollingMocks(
    ...records: Array<{ id: string; status: string; [key: string]: unknown }>
  ) {
    const fetchMocks = [
      makeTomlResponse(TOML_TEXT),
      makeJsonResponse({ transaction: CHALLENGE_XDR }),
      makeJsonResponse({ token: ANCHOR_JWT }),
      ...records.map((r) => makeJsonResponse({ transaction: r })),
    ];

    let callIndex = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      const result = fetchMocks[callIndex];
      callIndex += 1;
      return Promise.resolve(result);
    });

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });
  }

  it("polls until a terminal status and returns the record", async () => {
    jest.useFakeTimers();

    setupPollingMocks(
      { id: "tx-poll", status: "pending_user_transfer_start" },
      { id: "tx-poll", status: "pending_anchor" },
      { id: "tx-poll", status: "completed", amount_out: "99.5" },
    );

    const onUpdate = jest.fn();
    const pollPromise = pollAnchorTransaction({
      account: TEST_ACCOUNT, id: "tx-poll", intervalMs: 100, onUpdate,
    });

    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);

    const result = await pollPromise;

    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
    expect(result!.amount_out).toBe("99.5");
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it("returns null when timeoutMs is reached", async () => {
    jest.useFakeTimers();

    setupPollingMocks(
      { id: "tx-slow", status: "pending_user_transfer_start" },
      { id: "tx-slow", status: "pending_user_transfer_start" },
      { id: "tx-slow", status: "pending_user_transfer_start" },
      { id: "tx-slow", status: "pending_user_transfer_start" },
    );

    const onUpdate = jest.fn();
    const pollPromise = pollAnchorTransaction({
      account: TEST_ACCOUNT, id: "tx-slow", intervalMs: 100, timeoutMs: 250, onUpdate,
    });

    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);

    const result = await pollPromise;

    expect(result).toBeNull();
    // 3 polls complete before the 250ms deadline is exceeded
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it("returns null when isCancelled returns true (user closes popup)", async () => {
    jest.useFakeTimers();

    setupPollingMocks({ id: "tx-cancel", status: "pending_user_transfer_start" });

    const onUpdate = jest.fn();
    let cancelled = false;
    const isCancelled = jest.fn().mockImplementation(() => cancelled);

    const pollPromise = pollAnchorTransaction({
      account: TEST_ACCOUNT, id: "tx-cancel", intervalMs: 100, onUpdate, isCancelled,
    });

    await jest.advanceTimersByTimeAsync(100);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // User closes popup before next poll
    cancelled = true;
    await jest.advanceTimersByTimeAsync(100);

    const result = await pollPromise;
    expect(result).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("survives network failures during polling and keeps retrying", async () => {
    jest.useFakeTimers();

    const fetchMocks = [
      makeTomlResponse(TOML_TEXT),
      makeJsonResponse({ transaction: CHALLENGE_XDR }),
      makeJsonResponse({ token: ANCHOR_JWT }),
      () => Promise.reject(new Error("ECONNRESET")),
      makeJsonResponse({ transaction: { id: "tx-net", status: "completed" } }),
    ];

    let callIndex = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      const result = fetchMocks[callIndex];
      callIndex += 1;
      return typeof result === "function" ? result() : result;
    });

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const onUpdate = jest.fn();
    const pollPromise = pollAnchorTransaction({
      account: TEST_ACCOUNT, id: "tx-net", intervalMs: 100, onUpdate,
    });

    // Poll 1 runs synchronously at t=0 (mock network failure → onUpdate not called)
    await jest.advanceTimersByTimeAsync(0);
    expect(onUpdate).not.toHaveBeenCalled();

    // Poll 2 at t=100: succeeds
    await jest.advanceTimersByTimeAsync(100);

    const result = await pollPromise;
    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("survives persistent network failures and returns null on timeout", async () => {
    jest.useFakeTimers();

    const fetchMocks = [
      makeTomlResponse(TOML_TEXT),
      makeJsonResponse({ transaction: CHALLENGE_XDR }),
      makeJsonResponse({ token: ANCHOR_JWT }),
      () => Promise.reject(new Error("ECONNRESET")),
      () => Promise.reject(new Error("ECONNRESET")),
      () => Promise.reject(new Error("ECONNRESET")),
      () => Promise.reject(new Error("ECONNRESET")),
    ];

    let callIndex = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      const result = fetchMocks[callIndex];
      callIndex += 1;
      return typeof result === "function" ? result() : result;
    });

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const onUpdate = jest.fn();
    const pollPromise = pollAnchorTransaction({
      account: TEST_ACCOUNT, id: "tx-permanent-fail", intervalMs: 100, timeoutMs: 250, onUpdate,
    });

    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);

    const result = await pollPromise;
    expect(result).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("keeps polling when anchor returns 401 (JWT expires mid-poll)", async () => {
    jest.useFakeTimers();

    // Simulate: first poll succeeds, JWT expires, anchor returns 401,
    // then the next poll succeeds again (anchor recovered).
    // TOML + JWT remain cached across polls, so only tx fetches happen.
    const fetchMocks = [
      makeTomlResponse(TOML_TEXT),
      makeJsonResponse({ transaction: CHALLENGE_XDR }),
      makeJsonResponse({ token: ANCHOR_JWT }),
      // Poll 1: success
      makeJsonResponse({ transaction: { id: "tx-jwt", status: "pending_user_transfer_start" } }),
      // Poll 2: 401 — JWT expired
      makeJsonResponse({ error: "expired token" }, 401),
      // Poll 3: anchor recovered, succeeds
      makeJsonResponse({ transaction: { id: "tx-jwt", status: "completed", amount_out: "99" } }),
    ];

    let callIndex = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      const result = fetchMocks[callIndex];
      callIndex += 1;
      return result instanceof Promise ? result : Promise.resolve(result);
    });

    (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

    const onUpdate = jest.fn();
    const pollPromise = pollAnchorTransaction({
      account: TEST_ACCOUNT, id: "tx-jwt", intervalMs: 100, onUpdate,
    });

    // Poll 1 runs synchronously at t=0: success — onUpdate called
    await jest.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].status).toBe("pending_user_transfer_start");

    // Poll 2: 401 — onUpdate NOT called (fetchAnchorTransaction returns null)
    await jest.advanceTimersByTimeAsync(100);
    expect(onUpdate).toHaveBeenCalledTimes(1); // still 1

    // Poll 3: success again
    await jest.advanceTimersByTimeAsync(100);

    const result = await pollPromise;
    expect(result).not.toBeNull();
    expect(result!.status).toBe("completed");
    expect(onUpdate).toHaveBeenCalledTimes(2); // poll 1 + poll 3
  });

  it("calls onUpdate with each non-terminal record", async () => {
    jest.useFakeTimers();

    setupPollingMocks(
      { id: "tx-seq", status: "pending_user_transfer_start", amount_in: "10" },
      { id: "tx-seq", status: "pending_anchor", amount_in: "10" },
      { id: "tx-seq", status: "pending_anchor", amount_in: "10" },
      { id: "tx-seq", status: "completed", amount_in: "10", amount_out: "9.5" },
    );

    const onUpdate = jest.fn();
    const pollPromise = pollAnchorTransaction({
      account: TEST_ACCOUNT, id: "tx-seq", intervalMs: 100, onUpdate,
    });

    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(100);

    const result = await pollPromise;
    expect(result!.status).toBe("completed");
    expect(onUpdate).toHaveBeenCalledTimes(4);
    expect(onUpdate.mock.calls[0][0].status).toBe("pending_user_transfer_start");
    expect(onUpdate.mock.calls[3][0].status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// SEP-0031 — Cross-Border Payments
// ---------------------------------------------------------------------------

describe("SEP-0031 cross-border payments", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearAnchorCaches();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("fetchSep31Info", () => {
    it("returns receive info when DIRECT_PAYMENT_SERVER is available", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
        .mockResolvedValueOnce(makeSep31InfoResponse());

      const info = await fetchSep31Info("testanchor.stellar.org");

      expect(info).not.toBeNull();
      expect(info!.receive.USD.enabled).toBe(true);
      expect(info!.receive.USD.min_amount).toBe(10);
      expect(info!.receive.EUR.enabled).toBe(false);
    });

    it("returns null when anchor has no DIRECT_PAYMENT_SERVER", async () => {
      const noDirectToml = `WEB_AUTH_ENDPOINT="https://example.com/auth"`;
      global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(noDirectToml));

      const info = await fetchSep31Info("no-direct.example");

      expect(info).toBeNull();
    });

    it("returns null when /info returns non-OK", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
        .mockResolvedValueOnce(makeJsonResponse({ error: "unavailable" }, 503));

      const info = await fetchSep31Info("testanchor.stellar.org");

      expect(info).toBeNull();
    });
  });

  describe("initiateSep31Send", () => {
    it("returns send instructions on success", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
        .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
        .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
        .mockResolvedValueOnce(makeSep31SendResponse());

      (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

      const result = await initiateSep31Send({
        account: TEST_ACCOUNT,
        amount: "100",
        assetCode: "USDC",
        fields: { transaction: { receiver_currency: "USD" } },
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe("sep31-tx-abc");
      expect(result!.stellar_account_id).toBe("GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890A");
      expect(result!.stellar_memo).toBe("123456");
    });

    it("throws when anchor has no DIRECT_PAYMENT_SERVER", async () => {
      const noDirectToml = `WEB_AUTH_ENDPOINT="https://example.com/auth"`;
      global.fetch = jest.fn().mockResolvedValue(makeTomlResponse(noDirectToml));

      await expect(
        initiateSep31Send({
          homeDomain: "no-direct.example",
          account: TEST_ACCOUNT,
          amount: "100",
          assetCode: "USDC",
        }),
      ).rejects.toThrow("This anchor does not support SEP-0031");
    });

    it("throws when POST /transactions returns non-OK", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeTomlResponse(TOML_TEXT))
        .mockResolvedValueOnce(makeJsonResponse({ transaction: CHALLENGE_XDR }))
        .mockResolvedValueOnce(makeJsonResponse({ token: ANCHOR_JWT }))
        .mockResolvedValueOnce(makeJsonResponse({ error: "amount too small" }, 400));

      (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: SIGNED_XDR, error: null });

      await expect(
        initiateSep31Send({
          account: TEST_ACCOUNT,
          amount: "1",
          assetCode: "USDC",
        }),
      ).rejects.toThrow("SEP-0031 transaction failed (400)");
    });
  });
});

// ---------------------------------------------------------------------------
// ANCHOR_TERMINAL_STATUSES — Static set
// ---------------------------------------------------------------------------

describe("ANCHOR_TERMINAL_STATUSES", () => {
  it("contains all required SEP-24 terminal statuses", () => {
    const required = ["completed", "refunded", "expired", "no_market", "too_small", "too_large", "error"];
    for (const status of required) {
      expect(ANCHOR_TERMINAL_STATUSES.has(status)).toBe(true);
    }
  });

  it("does not contain non-terminal statuses", () => {
    expect(ANCHOR_TERMINAL_STATUSES.has("pending_user_transfer_start")).toBe(false);
    expect(ANCHOR_TERMINAL_STATUSES.has("pending_anchor")).toBe(false);
    expect(ANCHOR_TERMINAL_STATUSES.has("pending_external")).toBe(false);
    expect(ANCHOR_TERMINAL_STATUSES.has("incomplete")).toBe(false);
  });
});
