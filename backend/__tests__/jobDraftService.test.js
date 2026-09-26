"use strict";

const mockQuery = jest.fn();

jest.mock("../src/db/pool", () => ({
  query: (...args) => mockQuery(...args),
}));

const { saveDraft } = require("../src/services/jobDraftService");

describe("jobDraftService", () => {
  beforeEach(() => mockQuery.mockReset());

  it("uses one ownership-safe upsert for an existing draft", async () => {
    const draft = { id: "draft-1", client_address: "GCLIENT", title: "Updated" };
    mockQuery.mockResolvedValue({ rows: [draft] });

    await expect(saveDraft("GCLIENT", {
      id: "draft-1",
      title: "Updated",
      description: "Description",
    })).resolves.toEqual(draft);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [query, values] = mockQuery.mock.calls[0];
    expect(query).toContain("ON CONFLICT (id) DO UPDATE");
    expect(query).toContain("WHERE job_drafts.client_address = $2");
    expect(values).toEqual([
      "draft-1",
      "GCLIENT",
      "Updated",
      "Description",
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      [],
      undefined,
    ]);
  });
});
