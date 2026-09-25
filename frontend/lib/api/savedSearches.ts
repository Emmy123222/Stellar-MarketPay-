import { api } from "./client";

export interface SavedSearch {
  id: string;
  user_address: string;
  query_params: Record<string, any>;
  notify_in_app: boolean;
  notify_email: boolean;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  const { data } = await api.get<{ success: boolean; data: SavedSearch[] }>(
    "/api/saved-searches"
  );
  return data.data;
}

export async function createSavedSearch(payload: {
  query_params: Record<string, any>;
  notify_in_app?: boolean;
  notify_email?: boolean;
}): Promise<SavedSearch> {
  const { data } = await api.post<{ success: boolean; data: SavedSearch }>(
    "/api/saved-searches",
    payload
  );
  return data.data;
}

export async function updateSavedSearch(
  id: string,
  payload: { notify_in_app?: boolean; notify_email?: boolean }
): Promise<SavedSearch> {
  const { data } = await api.patch<{ success: boolean; data: SavedSearch }>(
    `/api/saved-searches/${id}`,
    payload
  );
  return data.data;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await api.delete(`/api/saved-searches/${id}`);
}
