import { api } from "./client";

/** Autocomplete suggestions for the skills tag input (GET /api/skills?q=). */
export async function fetchSkillSuggestions(query: string): Promise<string[]> {
  const { data } = await api.get<string[]>("/api/skills", {
    params: { q: query },
  });
  return data;
}
