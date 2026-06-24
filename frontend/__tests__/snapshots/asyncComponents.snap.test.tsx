import "../setup/snapshotMocks";

import { act, render, waitFor } from "@testing-library/react";
import {
  sampleJob,
  MOCK_PK,
  MOCK_PK_B,
} from "../helpers/fixtures";
import * as api from "@/lib/api";

import OfflineBanner from "@/components/OfflineBanner";
import FaucetButton from "@/components/FaucetButton";
import AdminAnalytics from "@/components/AdminAnalytics";
import JobAnalyticsPanel from "@/components/JobAnalytics";
import MessageThread from "@/components/MessageThread";
import NotificationBell from "@/components/NotificationBell";
import ReferralDashboard from "@/components/ReferralDashboard";
import PasskeyManager from "@/components/PasskeyManager";
import EditProfileForm from "@/components/EditProfileForm";
import TimeTracker from "@/components/TimeTracker";
import XlmPriceWidget from "@/components/XlmPriceWidget";

const noop = jest.fn();

describe("async component snapshots", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("OfflineBanner", () => {
    it("offline state", async () => {
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        value: false,
      });

      const { container } = render(<OfflineBanner />);
      await waitFor(() => {
        expect(container.querySelector('[role="alert"]')).toBeTruthy();
      });
      expect(container.firstChild).toMatchSnapshot("OfflineBanner offline");
    });
  });

  describe("FaucetButton", () => {
    it("default visible state", async () => {
      const { container } = render(
        <FaucetButton publicKey={MOCK_PK} currentBalance="0" />,
      );
      await waitFor(() => {
        expect(container.querySelector("button")).toBeTruthy();
      });
      expect(container.firstChild).toMatchSnapshot("FaucetButton");
    });
  });

  describe("AdminAnalytics", () => {
    it("loading", () => {
      const { container } = render(<AdminAnalytics publicKey={MOCK_PK} />);
      expect(container.firstChild).toMatchSnapshot("AdminAnalytics loading");
    });

    it("populated", async () => {
      const { container } = render(<AdminAnalytics publicKey={MOCK_PK} />);
      await waitFor(() => {
        expect(container.textContent).toMatch(/Total Jobs|Jobs/i);
      });
      expect(container.firstChild).toMatchSnapshot("AdminAnalytics populated");
    });

    it("error", async () => {
      jest.spyOn(api, "fetchAdminMetrics").mockRejectedValueOnce(new Error("API down"));
      const { container } = render(<AdminAnalytics publicKey={MOCK_PK} />);
      await waitFor(() => {
        expect(container.textContent).toMatch(/failed|error/i);
      });
      expect(container.firstChild).toMatchSnapshot("AdminAnalytics error");
    });
  });

  describe("JobAnalyticsPanel", () => {
    it("loading", () => {
      const { container } = render(<JobAnalyticsPanel job={sampleJob} />);
      expect(container.firstChild).toMatchSnapshot("JobAnalyticsPanel loading");
    });

    it("populated", async () => {
      const { container } = render(<JobAnalyticsPanel job={sampleJob} />);
      await waitFor(() => {
        expect(container.textContent).toMatch(/Application|Bid|Timeline/i);
      });
      expect(container.firstChild).toMatchSnapshot("JobAnalyticsPanel populated");
    });
  });

  describe("MessageThread", () => {
    it("loading", () => {
      const { container } = render(
        <MessageThread jobId="job-1" currentUserAddress={MOCK_PK} otherUserAddress={MOCK_PK_B} />,
      );
      expect(container.firstChild).toMatchSnapshot("MessageThread loading");
    });

    it("empty", async () => {
      const { container } = render(
        <MessageThread jobId="job-1" currentUserAddress={MOCK_PK} otherUserAddress={MOCK_PK_B} />,
      );
      await waitFor(() => {
        expect(container.textContent).toMatch(/No messages yet/i);
      });
      expect(container.firstChild).toMatchSnapshot("MessageThread empty");
    });

    it("error", async () => {
      jest.spyOn(api, "fetchMessages").mockRejectedValueOnce(new Error("Network error"));
      const { container } = render(
        <MessageThread jobId="job-1" currentUserAddress={MOCK_PK} otherUserAddress={MOCK_PK_B} />,
      );
      await waitFor(() => {
        expect(container.textContent).toMatch(/Network error|Failed/i);
      });
      expect(container.firstChild).toMatchSnapshot("MessageThread error");
    });
  });

  describe("NotificationBell", () => {
    it("default closed", () => {
      const { container } = render(<NotificationBell publicKey={MOCK_PK} />);
      expect(container.firstChild).toMatchSnapshot("NotificationBell closed");
    });

    it("open empty", async () => {
      const { container, getByRole } = render(<NotificationBell publicKey={MOCK_PK} />);
      await waitFor(() => {
        expect(getByRole("button")).toBeTruthy();
      });
      await act(async () => {
        getByRole("button").click();
      });
      await waitFor(() => {
        expect(container.textContent).toMatch(/No notifications yet/i);
      });
      expect(container.firstChild).toMatchSnapshot("NotificationBell open empty");
    });
  });

  describe("ReferralDashboard", () => {
    it("loading", () => {
      const { container } = render(<ReferralDashboard publicKey={MOCK_PK} />);
      expect(container.firstChild).toMatchSnapshot("ReferralDashboard loading");
    });

    it("empty", async () => {
      const { container } = render(<ReferralDashboard publicKey={MOCK_PK} />);
      await waitFor(() => {
        expect(container.textContent).toMatch(/Refer & Earn/i);
      });
      expect(container.firstChild).toMatchSnapshot("ReferralDashboard empty");
    });

    it("error", async () => {
      jest.spyOn(api, "fetchReferralStats").mockRejectedValueOnce(new Error("Failed"));
      const { container } = render(<ReferralDashboard publicKey={MOCK_PK} />);
      await waitFor(() => {
        expect(container.textContent).toMatch(/retry|failed|error/i);
      });
      expect(container.firstChild).toMatchSnapshot("ReferralDashboard error");
    });
  });

  describe("PasskeyManager", () => {
    it("loading", () => {
      const { container } = render(<PasskeyManager publicKey={MOCK_PK} />);
      expect(container.firstChild).toMatchSnapshot("PasskeyManager loading");
    });

    it("empty", async () => {
      const { container } = render(<PasskeyManager publicKey={MOCK_PK} />);
      await waitFor(() => {
        expect(container.querySelector(".animate-pulse")).toBeNull();
      });
      expect(container.firstChild).toMatchSnapshot("PasskeyManager empty");
    });
  });

  describe("EditProfileForm", () => {
    it("loading", () => {
      const { container } = render(<EditProfileForm publicKey={MOCK_PK} />);
      expect(container.firstChild).toMatchSnapshot("EditProfileForm loading");
    });

    it("populated", async () => {
      const { container } = render(<EditProfileForm publicKey={MOCK_PK} />);
      await waitFor(() => {
        expect(container.querySelector("form")).toBeTruthy();
      });
      expect(container.firstChild).toMatchSnapshot("EditProfileForm populated");
    });
  });

  describe("TimeTracker", () => {
    it("loading", () => {
      const { container } = render(
        <TimeTracker jobId="job-1" isFreelancer />,
      );
      expect(container.firstChild).toMatchSnapshot("TimeTracker loading");
    });

    it("empty client view", async () => {
      const { container } = render(
        <TimeTracker jobId="job-1" isClient />,
      );
      await waitFor(() => {
        expect(container.textContent).toMatch(/No time entries yet/i);
      });
      expect(container.firstChild).toMatchSnapshot("TimeTracker empty");
    });
  });

  describe("XlmPriceWidget", () => {
    it("loading", () => {
      const { container } = render(<XlmPriceWidget />);
      expect(container.firstChild).toMatchSnapshot("XlmPriceWidget loading");
    });

    it("populated", async () => {
      const { container } = render(<XlmPriceWidget />);
      await waitFor(() => {
        expect(container.textContent).toMatch(/XLM|USD/i);
      });
      expect(container.firstChild).toMatchSnapshot("XlmPriceWidget populated");
    });

    it("error", async () => {
      jest.spyOn(api, "fetchXlmPriceHistory").mockRejectedValueOnce(new Error("Failed"));
      const { container } = render(<XlmPriceWidget />);
      await waitFor(() => {
        expect(container.textContent).toMatch(/failed|error|unavailable/i);
      });
      expect(container.firstChild).toMatchSnapshot("XlmPriceWidget error");
    });
  });
});
