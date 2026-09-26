import { render, screen } from "@testing-library/react";
import DisputeTimeline from "../DisputeTimeline";
import { DisputeTimelineEvent } from "@/lib/api";

// Mock format utilities' date-fns dependence is fine in jsdom, but we mock
// @/lib/api to keep this a pure component test (pattern: NotificationBell.test.tsx).
jest.mock("@/lib/api", () => ({
  // Component only imports the DisputeTimelineEvent type (erased at runtime).
}));

const CLIENT = "G" + "A".repeat(55);
const FREELANCER = "G" + "B".repeat(55);
const ARBITRATOR = "G" + "D".repeat(55);

function makeEvent(overrides: Partial<DisputeTimelineEvent> = {}): DisputeTimelineEvent {
  return {
    id: overrides.id || "event-1",
    jobId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    eventType: "opened",
    actorAddress: CLIENT,
    evidenceId: null,
    payload: {},
    evidence: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("DisputeTimeline", () => {
  it("renders events in chronological (oldest-first) order", () => {
    const events: DisputeTimelineEvent[] = [
      makeEvent({ id: "e1", eventType: "opened", createdAt: "2026-01-01T10:00:00.000Z" }),
      makeEvent({
        id: "e2",
        eventType: "evidence_submitted",
        actorAddress: FREELANCER,
        createdAt: "2026-01-02T10:00:00.000Z",
      }),
      makeEvent({
        id: "e3",
        eventType: "resolved",
        actorAddress: ARBITRATOR,
        payload: { resolution: "release_funds" },
        createdAt: "2026-01-03T10:00:00.000Z",
      }),
    ];

    render(<DisputeTimeline events={events} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Dispute opened");
    expect(items[1]).toHaveTextContent("Evidence submitted");
    expect(items[2]).toHaveTextContent("Dispute resolved — funds released to freelancer");
  });

  it("shows the acting party address and formatted timestamp", () => {
    render(
      <DisputeTimeline
        events={[makeEvent({ actorAddress: CLIENT, createdAt: "2026-01-15T12:00:00.000Z" })]}
      />,
    );

    // shortenAddress keeps the first/last 6 chars; the address shares a <p> with
    // the timestamps, so match by regex against the paragraph's text content
    expect(screen.getByText(/GAAAAA\.\.\.AAAAAA/)).toBeInTheDocument();
    expect(screen.getByText(/Jan 15, 2026/)).toBeInTheDocument();
  });

  it("links attached evidence to its IPFS gateway URL", () => {
    const events = [
      makeEvent({
        eventType: "evidence_submitted",
        evidenceId: "ev-1",
        evidence: {
          id: "ev-1",
          fileName: "screenshot.png",
          mimeType: "image/png",
          gatewayUrl: "https://gateway.pinata.cloud/ipfs/QmTest",
        },
      }),
    ];

    render(<DisputeTimeline events={events} />);

    const link = screen.getByRole("link", { name: /screenshot\.png/ });
    expect(link).toHaveAttribute("href", "https://gateway.pinata.cloud/ipfs/QmTest");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders the empty state when there are no events", () => {
    render(<DisputeTimeline events={[]} />);

    expect(screen.getByTestId("timeline-empty")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders a loading placeholder instead of events while loading", () => {
    render(<DisputeTimeline events={[]} loading />);

    expect(screen.getByTestId("timeline-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-empty")).not.toBeInTheDocument();
  });

  it("labels every supported event type including arbitrator_assigned", () => {
    const events = [makeEvent({ eventType: "arbitrator_assigned", actorAddress: ARBITRATOR })];

    render(<DisputeTimeline events={events} />);

    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Arbitrator assigned");
  });
});
