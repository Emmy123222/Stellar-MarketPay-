"use strict";

const mockQuery = jest.fn();
const mockNotification = jest.fn();

jest.mock("../db/pool", () => ({ query: (...args) => mockQuery(...args) }));
jest.mock("./notificationService", () => ({
  createInAppNotification: (...args) => mockNotification(...args),
}));
jest.mock("../utils/email", () => ({ sendEmail: jest.fn() }));
jest.mock("../utils/logger", () => ({
  createServiceLogger: () => ({ info: jest.fn(), error: jest.fn() }),
}));

const { checkSavedSearchAlerts } = require("./savedSearchAlertService");

describe("saved search alerts", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockNotification.mockReset();
  });

  it("does not alert for deactivated or soft-deleted searches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(checkSavedSearchAlerts()).resolves.toMatchObject({
      searchesChecked: 0,
      inAppNotifications: 0,
      emailNotifications: 0,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ss\.active\s*=\s*TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/ss\.deleted_at\s+IS\s+NULL/);
    expect(mockNotification).not.toHaveBeenCalled();
  });
});
