import { api } from "./client";

export interface CategoryNode {
  id: number;
  slug: string;
  name: string;
  children: CategoryNode[];
}

export async function fetchCategories(): Promise<CategoryNode[]> {
  try {
    const { data } = await api.get<{ success: boolean; data: CategoryNode[] }>("/api/categories");
    return data.data;
  } catch {
    return [];
  }
}
