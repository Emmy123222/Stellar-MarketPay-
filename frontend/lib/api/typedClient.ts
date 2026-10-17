/**
 * lib/api/typedClient.ts
 * Type-safe API client wrapper generated from the OpenAPI specification (Issue #1888).
 * Provides compile-time checked requests and response types.
 */
import { api } from "./client";
import type { paths, components } from "./schema";

export type Schemas = components["schemas"];
export type ApiPaths = paths;

export type PathMethod<P extends keyof paths, M extends "get" | "post" | "put" | "patch" | "delete"> =
  paths[P] extends Record<M, any> ? paths[P][M] : never;

export type QueryParams<P extends keyof paths, M extends "get" | "post" | "put" | "patch" | "delete"> =
  PathMethod<P, M> extends { parameters?: { query?: infer Q } } ? Q : undefined;

export type RequestBody<P extends keyof paths, M extends "get" | "post" | "put" | "patch" | "delete"> =
  PathMethod<P, M> extends { requestBody?: { content: { "application/json": infer B } } } ? B : undefined;

export type ResponseData<P extends keyof paths, M extends "get" | "post" | "put" | "patch" | "delete", S extends number = 200> =
  PathMethod<P, M> extends { responses: { [K in S]: { content: { "application/json": infer D } } } } ? D : unknown;

/**
 * Type-safe HTTP request wrappers enforcing OpenAPI contract.
 */
export const typedClient = {
  /**
   * Type-safe GET request
   */
  async get<P extends keyof paths>(
    path: P,
    params?: QueryParams<P, "get">,
  ): Promise<ResponseData<P, "get", 200>> {
    const { data } = await api.get<ResponseData<P, "get", 200>>(path as string, { params });
    return data;
  },

  /**
   * Type-safe POST request
   */
  async post<P extends keyof paths, S extends number = 200 | 201>(
    path: P,
    body?: RequestBody<P, "post">,
  ): Promise<ResponseData<P, "post", S>> {
    const { data } = await api.post<ResponseData<P, "post", S>>(path as string, body);
    return data;
  },
};
