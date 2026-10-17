/**
 * packages/client/src/client.ts
 * Typed client consumer generated from OpenAPI specification (Issue #1888).
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import type { paths, components } from "./schema";

export type ClientConfig = {
  baseURL?: string;
  token?: string;
  timeout?: number;
  headers?: Record<string, string>;
};

export type Job = components["schemas"]["Job"];
export type Application = components["schemas"]["Application"];
export type Profile = components["schemas"]["Profile"];
export type ApiError = components["schemas"]["Error"];

export class StellarMarketPayClient {
  private http: AxiosInstance;
  private token?: string;

  constructor(config: ClientConfig = {}) {
    this.token = config.token;
    this.http = axios.create({
      baseURL: config.baseURL || "https://api.stellarmarketpay.com",
      timeout: config.timeout || 30000,
      headers: {
        "Content-Type": "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        ...config.headers,
      },
    });
  }

  public setToken(token: string): void {
    this.token = token;
    this.http.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }

  public jobs = {
    list: async (params?: paths["/api/jobs"]["get"]["parameters"]["query"]) => {
      const { data } = await this.http.get<
        paths["/api/jobs"]["get"]["responses"][200]["content"]["application/json"]
      >("/api/jobs", { params });
      return data;
    },

    get: async (id: string, viewerAddress?: string) => {
      const { data } = await this.http.get<{ success?: boolean; data: Job }>(
        `/api/jobs/${id}`,
        { params: viewerAddress ? { viewerAddress } : undefined },
      );
      return data;
    },

    create: async (body: paths["/api/jobs"]["post"]["requestBody"]["content"]["application/json"]) => {
      const { data } = await this.http.post<
        paths["/api/jobs"]["post"]["responses"][201]["content"]["application/json"]
      >("/api/jobs", body);
      return data;
    },
  };

  public applications = {
    listForJob: async (
      jobId: string,
      params?: paths["/api/applications/job/{jobId}"]["get"]["parameters"]["query"],
    ) => {
      const { data } = await this.http.get<
        paths["/api/applications/job/{jobId}"]["get"]["responses"][200]["content"]["application/json"]
      >(`/api/applications/job/${jobId}`, { params });
      return data;
    },

    submit: async (
      body: paths["/api/applications"]["post"]["requestBody"]["content"]["application/json"],
    ) => {
      const { data } = await this.http.post<
        paths["/api/applications"]["post"]["responses"][201]["content"]["application/json"]
      >("/api/applications", body);
      return data;
    },

    listForFreelancer: async (publicKey: string) => {
      const { data } = await this.http.get<{ success?: boolean; data: Application[] }>(
        `/api/applications/freelancer/${publicKey}`,
      );
      return data;
    },
  };
}

export function createClient(config?: ClientConfig): StellarMarketPayClient {
  return new StellarMarketPayClient(config);
}
