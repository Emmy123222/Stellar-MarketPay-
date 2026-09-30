"use strict";

const mockQuery = jest.fn();

jest.mock("../db/pool", () => ({ query: (...args) => mockQuery(...args) }));

const { cleanupExpiredScopeSessions } = require("./scopeSessionCleanup");

describe("scope session cleanup", () => {
  beforeEach(() => mockQuery.mockReset());

  it("deletes expired sessions and logs the deleted count", async () => {
    mockQuery.mockResolvedValue({ rowCount: 3 });
    const log = jest.fn();

    await expect(cleanupExpiredScopeSessions({ log })).resolves.toBe(3);

    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM scope_sessions WHERE expires_at <= NOW()",
    );
    expect(log).toHaveBeenCalledWith("Cleaned 3 expired scope sessions");
  });
});
