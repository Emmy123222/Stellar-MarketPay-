import { render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import StatusPage from "@/pages/status";
import { useApi } from "@/hooks/useApi";

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/lib/api", () => ({
  fetchHealthStatus: jest.fn(),
  fetchIndexerHealth: jest.fn(),
  subscribeStatusAlerts: jest.fn(),
}));

jest.mock("@/hooks/useApi", () => ({
  useApi: jest.fn(),
}));

class MockWebSocket {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor() {
    setTimeout(() => this.onopen?.(new Event("open")), 0);
  }

  close() {
    this.onclose?.(new CloseEvent("close"));
  }
}

const HEALTHY_STATUS = {
  value: {
    status: "healthy" as const,
    database: "up",
    redis: "up",
    uptime_seconds: 120,
    version: "1.0.0",
  },
  checkedAt: "2026-10-16T01:00:00.000Z",
};

const HEALTHY_INDEXER = {
  value: {
    status: "ok" as const,
    indexer: {
      running: true,
      synced: true,
      lastProcessedLedger: 1234,
      lastTransactionAt: null,
      lastError: null,
    },
    currentLedger: 1234,
  },
  checkedAt: "2026-10-16T01:00:00.000Z",
};

const mockUseApi = useApi as jest.Mock;

function renderWithStatus(options: {
  healthData?: typeof HEALTHY_STATUS | undefined;
  healthError?: Error;
  indexerData?: typeof HEALTHY_INDEXER | undefined;
  indexerError?: Error;
} = {}) {
  const healthData =
    "healthData" in options ? options.healthData : HEALTHY_STATUS;
  const indexerData =
    "indexerData" in options ? options.indexerData : HEALTHY_INDEXER;
  const { healthError, indexerError } = options;

  mockUseApi.mockImplementation((key: string) => ({
    data: key === "/health" ? healthData : indexerData,
    error: key === "/health" ? healthError : indexerError,
    isLoading: false,
    isValidating: false,
  }));

  return render(<StatusPage />);
}

beforeAll(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: MockWebSocket,
  });
});

beforeEach(() => {
  mockUseApi.mockReset();
});

describe("System status page", () => {
  it("shows live component statuses and their last-checked times", async () => {
    renderWithStatus();

    expect(screen.getByRole("region", { name: "API status" })).toHaveTextContent(
      "Operational",
    );
    expect(
      screen.getByRole("region", { name: "Database status" }),
    ).toHaveTextContent("Operational");
    expect(screen.getByRole("region", { name: "Redis status" })).toHaveTextContent(
      "Operational",
    );
    expect(
      screen.getByRole("region", { name: "Indexer lag status" }),
    ).toHaveTextContent("0 ledgers behind");
    expect(
      screen.getByRole("region", { name: "Database status" }),
    ).toHaveTextContent("Last checked:");

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "WebSocket status" })).toHaveTextContent(
        "Operational",
      );
    });

    expect(mockUseApi).toHaveBeenCalledWith(
      "/health",
      expect.any(Function),
      expect.objectContaining({ refreshInterval: 60_000 }),
    );
  });

  it("shows dependency degradation while keeping the reachable API distinct", () => {
    renderWithStatus({
      healthData: {
        ...HEALTHY_STATUS,
        value: { ...HEALTHY_STATUS.value, status: "degraded", database: "down" },
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "backend reports one or more degraded dependencies",
    );
    expect(screen.getByRole("region", { name: "API status" })).toHaveTextContent(
      "Operational",
    );
    expect(
      within(screen.getByRole("region", { name: "Database status" })).getByText(
        "Degraded",
      ),
    ).toBeInTheDocument();
  });

  it("warns when the indexer is more than five ledgers behind", () => {
    renderWithStatus({
      indexerData: {
        ...HEALTHY_INDEXER,
        value: {
          ...HEALTHY_INDEXER.value,
          currentLedger: 1240,
          indexer: { ...HEALTHY_INDEXER.value.indexer, lastProcessedLedger: 1234 },
        },
      },
    });

    const indexerTile = screen.getByRole("region", {
      name: "Indexer lag status",
    });
    expect(indexerTile).toHaveTextContent("Warning");
    expect(indexerTile).toHaveTextContent("6 ledgers behind");
    expect(screen.getByRole("alert")).toHaveTextContent("more than 5 ledgers");
  });

  it("renders unavailable health without hiding the rest of the page", () => {
    renderWithStatus({
      healthData: undefined,
      healthError: new Error("Network unavailable"),
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "backend health endpoint is unreachable",
    );
    expect(screen.getByRole("region", { name: "API status" })).toHaveTextContent(
      "Unavailable",
    );
    expect(
      screen.getByRole("region", { name: "Database status" }),
    ).toHaveTextContent("Unavailable");
    expect(screen.getByRole("heading", { name: "System Status" })).toBeInTheDocument();
  });
});
