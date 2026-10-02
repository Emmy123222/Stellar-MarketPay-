import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FreelancersBrowsePage from "@/pages/freelancers/index";
import * as api from "@/lib/api";
import * as savedSearchesApi from "@/lib/api/savedSearches";

jest.mock("@/lib/api", () => ({
  fetchProfiles: jest.fn(),
}));

jest.mock("@/lib/api/savedSearches", () => ({
  fetchSavedSearches: jest.fn(),
  createSavedSearch: jest.fn(),
  deleteSavedSearch: jest.fn(),
}));

jest.mock("@/hooks/useApi", () => ({
  useApi: () => ({
    data: { profiles: [], nextCursor: null, hasMore: false },
    error: undefined,
    isLoading: false,
    isValidating: false,
  }),
}));

describe("Freelancers Directory Saved Searches (#1420)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (savedSearchesApi.fetchSavedSearches as jest.Mock).mockResolvedValue([
      {
        id: "search-1",
        user_address: "GA123",
        query_params: { search: "Rust developer", availability: "available" },
        notify_in_app: true,
        notify_email: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  });

  it("lists saved searches in the 'My Searches' sidebar panel", async () => {
    render(<FreelancersBrowsePage />);

    expect(screen.getByText("My Searches")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/"Rust developer"/)).toBeInTheDocument();
    });
  });

  it("stores current filter state in backend via createSavedSearch on 'Save this search' click", async () => {
    (savedSearchesApi.createSavedSearch as jest.Mock).mockResolvedValue({
      id: "search-2",
      user_address: "GA123",
      query_params: { search: "Frontend React", availability: "busy" },
      notify_in_app: true,
      notify_email: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    render(<FreelancersBrowsePage />);

    // Change availability and search input
    const availabilitySelect = screen.getByLabelText("Availability");
    fireEvent.change(availabilitySelect, { target: { value: "busy" } });

    const searchInput = screen.getByLabelText("Search");
    fireEvent.change(searchInput, { target: { value: "Frontend React" } });

    // Click "Save this search"
    const saveButton = screen.getByRole("button", { name: /save this search/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(savedSearchesApi.createSavedSearch).toHaveBeenCalledWith({
        query_params: { search: "Frontend React", availability: "busy" },
        notify_in_app: true,
        notify_email: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Search saved successfully!")).toBeInTheDocument();
    });
  });

  it("clicking a saved search restores all filter params", async () => {
    render(<FreelancersBrowsePage />);

    await waitFor(() => {
      expect(screen.getByText(/"Rust developer"/)).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText("Search") as HTMLInputElement;
    const availabilitySelect = screen.getByLabelText("Availability") as HTMLSelectElement;

    expect(searchInput.value).toBe("");
    expect(availabilitySelect.value).toBe("");

    // Click the saved search item
    const savedItem = screen.getByText(/"Rust developer"/);
    fireEvent.click(savedItem);

    expect(searchInput.value).toBe("Rust developer");
    expect(availabilitySelect.value).toBe("available");
  });
});
