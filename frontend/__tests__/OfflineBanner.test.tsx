import "./setup/snapshotMocks";
import { render, screen, act, waitFor } from "@testing-library/react";
import OfflineBanner from "@/components/OfflineBanner";

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setNavigatorOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

describe("OfflineBanner", () => {
  it("renders nothing when online", () => {
    setNavigatorOnline(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows offline banner when navigator is offline", async () => {
    setNavigatorOnline(false);
    render(<OfflineBanner />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
  });

  it("shows reconnecting message when coming back online and dismisses after 2s", () => {
    jest.useFakeTimers();
    setNavigatorOnline(false);
    render(<OfflineBanner />);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByText(/you're back online/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.queryByText(/you're back online/i)).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("reverts to offline banner if connection lost during reconnecting phase", () => {
    jest.useFakeTimers();
    setNavigatorOnline(false);
    render(<OfflineBanner />);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByText(/you're back online/i)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/you are offline/i)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("cleans up event listeners on unmount", () => {
    const addEventListenerSpy = jest.spyOn(window, "addEventListener");
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");

    const { unmount } = render(<OfflineBanner />);

    expect(addEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("shows cached job count link when jobs are stored in localStorage", async () => {
    localStorage.setItem(
      "marketpay_last_viewed_jobs",
      JSON.stringify([{ id: "1" }, { id: "2" }])
    );
    setNavigatorOnline(false);
    render(<OfflineBanner />);
    await waitFor(() => {
      expect(screen.getByText(/view 2 saved jobs/i)).toBeInTheDocument();
    });
  });

  it("uses jest.spyOn(window, 'dispatchEvent') to simulate online event", () => {
    jest.useFakeTimers();
    setNavigatorOnline(false);
    render(<OfflineBanner />);

    const dispatchEventSpy = jest.spyOn(window, "dispatchEvent");

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "online" })
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    dispatchEventSpy.mockRestore();
    jest.useRealTimers();
  });
});