/**
 * Unit tests for the /admin authentication guard (Issue #1423).
 *
 * Covers both layers of the guard:
 *   1. getServerSideProps — validates the backend-issued session JWT cookie
 *      server-side and redirects any non-admin / unauthenticated session to
 *      `/` before the admin layout can flash.
 *   2. The client-side guard — re-checks the in-memory JWT role and redirects
 *      non-admin sessions to `/` as defense in depth.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import AdminDashboard, { getServerSideProps } from "@/pages/admin";
import * as api from "@/lib/api";

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
    pathname: "/admin",
    query: {},
    isReady: true,
  }),
}));

jest.mock("@/components/Toast", () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  getJwtToken: jest.fn(),
  fetchAdminJobReports: jest.fn(),
  fetchAdminDisputes: jest.fn(),
  fetchAdminLogs: jest.fn(),
  fetchFrozenWallets: jest.fn(),
  resolveDispute: jest.fn(),
  adminCancelJob: jest.fn(),
  freezeWallet: jest.fn(),
  unfreezeWallet: jest.fn(),
  fetchAdmin2FAStatus: jest.fn(),
  fetchCostReport: jest.fn(),
  generateCostReport: jest.fn(),
  fetchTimeSeriesMetrics: jest.fn(),
}));

jest.mock("@/components/Admin2FAModal", () => ({
  __esModule: true,
  default: () => <div>Admin 2FA Modal</div>,
}));

jest.mock("@/components/AdminAnalytics", () => ({
  __esModule: true,
  default: () => <div>Admin Analytics Panel</div>,
}));

jest.mock("@/components/AdminApiKeyUsage", () => ({
  __esModule: true,
  default: () => <div>Admin API Key Usage Panel</div>,
}));

const ADMIN_PK = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USER_PK = "GAH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5X";

/** Build an unsigned-shaped JWT carrying the given payload claims. */
function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.test-signature`;
}

/** Invoke getServerSideProps with a cookie header (or none). */
function runGetServerSideProps(cookie?: string) {
  const context = {
    req: { headers: { ...(cookie ? { cookie } : {}) } },
    res: {},
    params: {},
    query: {},
    resolvedUrl: "/admin",
  } as any;
  return getServerSideProps(context);
}

describe("getServerSideProps admin guard", () => {
  it("redirects a non-admin session to the homepage", async () => {
    const result = await runGetServerSideProps(
      `token=${makeJwt({ role: "user", publicKey: USER_PK })}`,
    );

    expect(result).toEqual({
      redirect: { destination: "/", permanent: false },
    });
  });

  it("redirects an unauthenticated request (no session cookie) to the homepage", async () => {
    const result = await runGetServerSideProps();

    expect(result).toEqual({
      redirect: { destination: "/", permanent: false },
    });
  });

  it("redirects a malformed/corrupt session token to the homepage", async () => {
    const result = await runGetServerSideProps("token=not-a-valid.jwt");

    expect(result).toEqual({
      redirect: { destination: "/", permanent: false },
    });
  });

  it("lets an authorized admin session through without redirecting", async () => {
    const result = await runGetServerSideProps(
      `token=${makeJwt({ role: "admin", publicKey: ADMIN_PK })}; refreshToken=abc123`,
    );

    expect(result).toHaveProperty("props");
    expect(result).not.toHaveProperty("redirect");
    expect(result).toEqual({ props: { publicKey: null } });
  });
});

describe("AdminDashboard page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.fetchAdmin2FAStatus as jest.Mock).mockResolvedValue({
      totp_enabled: true,
      verified: true,
    });
    (api.fetchAdminDisputes as jest.Mock).mockResolvedValue([]);
    (api.fetchAdminJobReports as jest.Mock).mockResolvedValue([]);
    (api.fetchAdminLogs as jest.Mock).mockResolvedValue([]);
    (api.fetchFrozenWallets as jest.Mock).mockResolvedValue([]);
  });

  it("renders the dashboard for an authorized admin session without redirecting", async () => {
    (api.getJwtToken as jest.Mock).mockReturnValue(
      makeJwt({ role: "admin", publicKey: ADMIN_PK }),
    );

    render(<AdminDashboard publicKey={ADMIN_PK} />);

    expect(await screen.findByText("Admin Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects a non-admin session to the homepage client-side", async () => {
    (api.getJwtToken as jest.Mock).mockReturnValue(
      makeJwt({ role: "user", publicKey: USER_PK }),
    );

    render(<AdminDashboard publicKey={USER_PK} />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
    expect(
      await screen.findByText("Access denied. Admin role required."),
    ).toBeInTheDocument();
  });
});
