import { typedClient } from "@/lib/api/typedClient";
import { api } from "@/lib/api/client";
import { fetchJobs, fetchJob, createJob, fetchMyJobs } from "@/lib/api/jobs";
import {
  fetchApplicationsPage,
  submitApplication,
  fetchMyApplications,
} from "@/lib/api/applications";
import { useTypedApi } from "@/hooks/useApi";
import { renderHook } from "@testing-library/react";

jest.mock("@/lib/api/client", () => {
  const actual = jest.requireActual("@/lib/api/client");
  return {
    ...actual,
    api: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

describe("Typed OpenAPI Client & API Modules (Issue #1888)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("typedClient", () => {
    it("calls api.get with typed path and query parameters", async () => {
      const mockJobs = [{ id: "job-1", title: "Smart Contract Dev" }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: { jobs: mockJobs } });

      const result = await typedClient.get("/api/jobs", { limit: 10 });

      expect(api.get).toHaveBeenCalledWith("/api/jobs", { params: { limit: 10 } });
      expect(result).toEqual({ jobs: mockJobs });
    });

    it("calls api.post with typed path and request body", async () => {
      const mockJob = { id: "job-new", title: "New Job" };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: mockJob });

      const newJobPayload = {
        title: "Frontend Dev",
        description: "Build Next.js app",
        budget: "1000",
        category: "frontend",
        skills: ["react", "next.js"],
        visibility: "public" as const,
      };

      const result = await typedClient.post("/api/jobs", newJobPayload);

      expect(api.post).toHaveBeenCalledWith("/api/jobs", newJobPayload);
      expect(result).toEqual(mockJob);
    });
  });

  describe("jobs.ts typed calls", () => {
    it("fetchJobs forwards query options to api.get", async () => {
      const mockJob = { id: "job-1", title: "Job 1" };
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: {
          data: [mockJob],
          nextCursor: "cursor-123",
          total: 1,
        },
      });

      const data = await fetchJobs({ category: "development", limit: 20 });

      expect(api.get).toHaveBeenCalledWith("/api/jobs", {
        params: expect.objectContaining({ category: "development", limit: 20 }),
      });
      expect(data.jobs).toEqual([mockJob]);
      expect(data.nextCursor).toBe("cursor-123");
    });

    it("fetchJob queries specific job by id", async () => {
      const mockJob = { id: "job-99", title: "Rust Audit" };
      (api.get as jest.Mock).mockResolvedValueOnce({ data: { data: mockJob } });

      const data = await fetchJob("job-99");

      expect(api.get).toHaveBeenCalledWith("/api/jobs/job-99", { params: undefined });
      expect(data).toEqual(mockJob);
    });

    it("createJob posts new job payload", async () => {
      const mockJob = { id: "job-created", title: "Backend API" };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { data: mockJob } });

      const payload = {
        title: "Backend API",
        description: "Build Node API",
        budget: "2500",
        category: "backend",
        skills: ["node", "express"],
        clientAddress: "GCLIENT123",
      };

      const data = await createJob(payload);

      expect(api.post).toHaveBeenCalledWith("/api/jobs", payload);
      expect(data).toEqual(mockJob);
    });

    it("fetchMyJobs queries client jobs", async () => {
      const mockJobs = [{ id: "job-mine", title: "My Job" }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: { data: mockJobs } });

      const data = await fetchMyJobs("GCLIENT123");

      expect(api.get).toHaveBeenCalledWith("/api/jobs/client/GCLIENT123");
      expect(data).toEqual(mockJobs);
    });
  });

  describe("applications.ts typed calls", () => {
    it("fetchApplicationsPage fetches paginated applications for a job", async () => {
      const mockApplications = [{ id: "app-1", jobId: "job-1" }];
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: {
          applications: mockApplications,
          nextCursor: "cur-2",
        },
      });

      const data = await fetchApplicationsPage("job-1", "tier-1", "cur-1", 10);

      expect(api.get).toHaveBeenCalledWith("/api/applications/job/job-1", {
        params: { tier: "tier-1", cursor: "cur-1", limit: 10 },
      });
      expect(data.applications).toEqual(mockApplications);
      expect(data.nextCursor).toBe("cur-2");
    });

    it("submitApplication posts typed application data", async () => {
      const mockApp = { id: "app-created", jobId: "job-1" };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { data: mockApp } });

      const payload = {
        jobId: "job-1",
        freelancerAddress: "GFREELANCER123",
        proposal: "Hire me",
        bidAmount: "500",
        currency: "XLM",
      };

      const data = await submitApplication(payload);

      expect(api.post).toHaveBeenCalledWith("/api/applications", payload);
      expect(data).toEqual(mockApp);
    });

    it("fetchMyApplications queries freelancer applications", async () => {
      const mockApps = [{ id: "app-my-1" }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: { data: mockApps } });

      const data = await fetchMyApplications("GFREELANCER123");

      expect(api.get).toHaveBeenCalledWith("/api/applications/freelancer/GFREELANCER123");
      expect(data).toEqual(mockApps);
    });
  });

  describe("useTypedApi hook", () => {
    it("returns loading state initially and configures SWR key", () => {
      const { result } = renderHook(() =>
        useTypedApi("/api/jobs", { params: { limit: 5 } }),
      );

      expect(result.current.isLoading).toBe(true);
    });
  });
});
