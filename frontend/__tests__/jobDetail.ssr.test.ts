import { getServerSideProps } from "@/pages/jobs/[id]";
import type { GetServerSidePropsContext } from "next";

describe("jobs/[id] getServerSideProps", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function makeContext(params?: Record<string, string>, headers?: Record<string, string>): GetServerSidePropsContext {
    return {
      params,
      req: {
        headers: headers || {},
      } as any,
      res: {} as any,
      query: {},
      resolvedUrl: "",
    };
  }

  it("returns notFound: true if jobId is missing in params", async () => {
    const ctx = makeContext();
    const result = await getServerSideProps(ctx);
    expect(result).toEqual({ notFound: true });
  });

  it("returns notFound: true when API returns 404 for deleted or nonexistent job", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const ctx = makeContext({ id: "deleted-job-123" });
    const result = await getServerSideProps(ctx);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/jobs/deleted-job-123"),
      expect.anything()
    );
    expect(result).toEqual({ notFound: true });
  });

  it("returns ssrJob and ogBaseUrl when job is found (200 OK)", async () => {
    const mockJob = {
      id: "job-100",
      title: "Rust Developer",
      description: "Build smart contracts",
      category: "Development",
      budget: "500",
      currency: "XLM",
      status: "open",
      skills: ["Rust", "Soroban"],
      clientAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      createdAt: "2026-09-20T00:00:00Z",
    };

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: mockJob,
      }),
    } as Response);

    const ctx = makeContext(
      { id: "job-100" },
      { "x-forwarded-host": "marketpay.stellar.org", "x-forwarded-proto": "https" }
    );
    const result = await getServerSideProps(ctx);

    expect(result).toEqual({
      props: {
        ssrJob: mockJob,
        ogBaseUrl: "https://marketpay.stellar.org",
      },
    });
  });

  it("falls back to ssrJob: null on server error or network issue (500)", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const ctx = makeContext({ id: "job-100" });
    const result = await getServerSideProps(ctx);

    expect(result).toEqual({
      props: {
        ssrJob: null,
        ogBaseUrl: "https://marketpay.stellar.org",
      },
    });
  });
});
