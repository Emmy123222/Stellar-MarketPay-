/**
 * src/services/notificationService.test.js
 * Comprehensive tests for notification service
 */
"use strict";

// Mock the database pool before requiring the service
jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("axios", () => ({
  post: jest.fn().mockResolvedValue({ status: 200 }),
}));

jest.mock("../utils/logger", () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  })),
}));

jest.mock("../utils/queue", () => ({
  emailQueue: {
    add: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("./pushSubscriptionService", () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const axios = require("axios");
const pool = require("../db/pool");
const { emailQueue } = require("../utils/queue");
const pushSubscriptionService = require("./pushSubscriptionService");
const {
  queueNotification,
  createInAppNotification,
  createJobNotification,
  listInAppNotifications,
  markInAppNotificationRead,
  markAllInAppNotificationsRead,
  getUserPreferences,
  processPendingNotifications,
  notifyEscrowEvent,
  generateEmailContent,
  generateInAppContent,
  getNextRetryTime,
  sendEmail,
  sendWebhook,
  sendPushNotificationForEvent,
  EVENT_TYPES,
  setBroadcastToUser,
} = require("./notificationService");

describe("Notification Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBroadcastToUser(null);
  });

  const mockQuery = pool.query;
  const defaultAddress = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

  // ─── EVENT_TYPES ───────────────────────────────────────────────────────

  describe("EVENT_TYPES", () => {
    test("should export all required event types", () => {
      expect(EVENT_TYPES.ESCROW_CREATED).toBe("escrow_created");
      expect(EVENT_TYPES.WORK_STARTED).toBe("work_started");
      expect(EVENT_TYPES.ESCROW_RELEASED).toBe("escrow_released");
      expect(EVENT_TYPES.REFUND_ISSUED).toBe("refund_issued");
      expect(EVENT_TYPES.DISPUTE_OPENED).toBe("dispute_opened");
      expect(EVENT_TYPES.APPLICATION_RECEIVED).toBe("application_received");
      expect(EVENT_TYPES.APPLICATION_ACCEPTED).toBe("application_accepted");
      expect(EVENT_TYPES.APPLICATION_REJECTED).toBe("application_rejected");
      expect(EVENT_TYPES.NEW_MESSAGE).toBe("new_message");
      expect(EVENT_TYPES.JOB_COMPLETED).toBe("job_completed");
      expect(EVENT_TYPES.JOB_INVITED).toBe("job_invited");
    });
  });

  // ─── generateEmailContent ──────────────────────────────────────────────

  describe("generateEmailContent", () => {
    const mockData = {
      jobTitle: "Build a React App",
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      amount: "100",
      currency: "XLM",
    };

    test("should generate ESCROW_CREATED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.ESCROW_CREATED, mockData);
      expect(content.subject).toContain("Escrow Created");
      expect(content.subject).toContain(mockData.jobTitle);
      expect(content.text).toContain(mockData.jobTitle);
      expect(content.text).toContain(mockData.amount);
      expect(content.text).toContain(mockData.currency);
      expect(content.html).toContain(mockData.jobTitle);
      expect(content.html).toContain(mockData.amount);
    });

    test("should generate WORK_STARTED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.WORK_STARTED, mockData);
      expect(content.subject).toContain("Work Started");
      expect(content.text).toContain("Work has started");
    });

    test("should generate ESCROW_RELEASED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.ESCROW_RELEASED, mockData);
      expect(content.subject).toContain("Payment Released");
      expect(content.text).toContain("has been released");
    });

    test("should generate REFUND_ISSUED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.REFUND_ISSUED, mockData);
      expect(content.subject).toContain("Refund Issued");
      expect(content.text).toContain("refund");
    });

    test("should generate DISPUTE_OPENED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.DISPUTE_OPENED, mockData);
      expect(content.subject).toContain("Dispute Opened");
      expect(content.text).toContain("dispute has been opened");
    });

    test("should generate APPLICATION_ACCEPTED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.APPLICATION_ACCEPTED, mockData);
      expect(content.subject).toContain("Application Accepted");
      expect(content.text).toContain("application");
      expect(content.text).toContain("has been accepted");
    });

    test("should generate JOB_COMPLETED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.JOB_COMPLETED, mockData);
      expect(content.subject).toContain("Job Completed");
      expect(content.text).toContain("has been completed");
    });

    test("should generate JOB_INVITED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.JOB_INVITED, mockData);
      expect(content.subject).toContain("invited");
      expect(content.text).toContain("invited you");
    });

    test("should include job URL in all emails", () => {
      const events = Object.values(EVENT_TYPES);
      events.forEach((eventType) => {
        const content = generateEmailContent(eventType, mockData);
        expect(content.text).toContain(`/jobs/${mockData.jobId}`);
        expect(content.html).toContain(`/jobs/${mockData.jobId}`);
      });
    });

    test("should handle unknown event types with default template", () => {
      const content = generateEmailContent("unknown_event", mockData);
      expect(content.subject).toContain("Notification");
      expect(content.text).toContain("An event occurred");
      expect(content.html).toContain("Notification");
    });

    test("should handle special characters in title", () => {
      const dataWithSpecialChars = {
        ...mockData,
        jobTitle: "Build App & Test <Features>",
      };
      const content = generateEmailContent(EVENT_TYPES.ESCROW_CREATED, dataWithSpecialChars);
      expect(content.text).toContain(dataWithSpecialChars.jobTitle);
    });
  });

  // ─── generateInAppContent ──────────────────────────────────────────────

  describe("generateInAppContent", () => {
    const data = { jobTitle: "Test Job", jobId: "job-1", amount: "100", currency: "XLM", actorAddress: defaultAddress };

    test("should generate content for ESCROW_CREATED", () => {
      const content = generateInAppContent(EVENT_TYPES.ESCROW_CREATED, data);
      expect(content.title).toBe("Escrow created");
      expect(content.body).toContain("Escrow was created");
    });

    test("should generate content for APPLICATION_RECEIVED with actor address", () => {
      const content = generateInAppContent(EVENT_TYPES.APPLICATION_RECEIVED, data);
      expect(content.title).toBe("New application received");
      expect(content.body).toContain("applied to");
    });

    test("should generate content for NEW_MESSAGE", () => {
      const content = generateInAppContent(EVENT_TYPES.NEW_MESSAGE, data);
      expect(content.title).toBe("New message");
      expect(content.body).toContain("sent you a message");
    });

    test("should generate content for APPLICATION_REJECTED", () => {
      const content = generateInAppContent(EVENT_TYPES.APPLICATION_REJECTED, data);
      expect(content.title).toBe("Application rejected");
      expect(content.body).toContain("not selected");
    });

    test("should handle unknown event type with default", () => {
      const content = generateInAppContent("unknown_event", data);
      expect(content.title).toBe("New notification");
      expect(content.body).toContain("update");
    });
  });

  // ─── getNextRetryTime ──────────────────────────────────────────────────

  describe("getNextRetryTime", () => {
    test("should return a future date", () => {
      const result = getNextRetryTime(0);
      expect(result instanceof Date).toBe(true);
      expect(result.getTime()).toBeGreaterThan(Date.now());
    });

    test("should use exponential backoff", () => {
      const retry0 = getNextRetryTime(0).getTime();
      const retry1 = getNextRetryTime(1).getTime();
      const retry2 = getNextRetryTime(2).getTime();
      expect(retry1 - retry0).toBeGreaterThanOrEqual(60000); // 1 min
      expect(retry2 - retry1).toBeGreaterThanOrEqual(120000); // 2 min
    });
  });

  // ─── queueNotification ─────────────────────────────────────────────────

  describe("queueNotification", () => {
    beforeEach(() => {
      mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    });

    test("should insert a notification into the queue", async () => {
      const result = await queueNotification({
        recipientAddress: defaultAddress,
        notificationType: "email",
        eventType: EVENT_TYPES.ESCROW_CREATED,
        jobId: "job-1",
        payload: { amount: "100" },
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    test("should add email to bull queue for email notifications", async () => {
      await queueNotification({
        recipientAddress: defaultAddress,
        notificationType: "email",
        eventType: EVENT_TYPES.ESCROW_CREATED,
        jobId: "job-1",
        payload: { amount: "100" },
      });

      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({ notificationId: 1 }),
        expect.objectContaining({ attempts: 3 }),
      );
    });

    test("should NOT add to bull queue for webhook notifications", async () => {
      await queueNotification({
        recipientAddress: defaultAddress,
        notificationType: "webhook",
        eventType: EVENT_TYPES.ESCROW_RELEASED,
        jobId: "job-1",
        payload: { amount: "100" },
      });

      expect(emailQueue.add).not.toHaveBeenCalled();
    });
  });

  // ─── createInAppNotification ───────────────────────────────────────────

  describe("createInAppNotification", () => {
    beforeEach(() => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 1,
          user_address: defaultAddress,
          type: "escrow_created",
          title: "Test",
          body: "Test body",
          read: false,
          job_id: "job-1",
          link_path: "/jobs/job-1",
          created_at: new Date().toISOString(),
        }],
      });
    });

    test("should create and return an in-app notification", async () => {
      const notification = await createInAppNotification({
        userAddress: defaultAddress,
        type: EVENT_TYPES.ESCROW_CREATED,
        title: "Test",
        body: "Test body",
        jobId: "job-1",
      });

      expect(notification).toBeDefined();
      expect(notification.userAddress).toBe(defaultAddress);
    });

    test("should return null when no userAddress provided", async () => {
      const notification = await createInAppNotification({
        userAddress: null,
        type: EVENT_TYPES.ESCROW_CREATED,
        title: "Test",
        body: "Test body",
      });

      expect(notification).toBeNull();
    });

    test("should broadcast when setBroadcastToUser is configured", async () => {
      const broadcastMock = jest.fn();
      setBroadcastToUser(broadcastMock);

      await createInAppNotification({
        userAddress: defaultAddress,
        type: EVENT_TYPES.ESCROW_CREATED,
        title: "Test",
        body: "Test body",
        jobId: "job-1",
      });

      expect(broadcastMock).toHaveBeenCalledWith(
        defaultAddress,
        "notification:created",
        expect.any(Object),
      );
    });

    test("should send push notification when sendPush is true", async () => {
      await createInAppNotification({
        userAddress: defaultAddress,
        type: EVENT_TYPES.APPLICATION_ACCEPTED,
        title: "Accepted",
        body: "Your application was accepted",
        jobId: "job-1",
        sendPush: true,
      });

      expect(pushSubscriptionService.sendPushNotification).toHaveBeenCalled();
    });

    test("should skip push notification when sendPush is false", async () => {
      await createInAppNotification({
        userAddress: defaultAddress,
        type: EVENT_TYPES.APPLICATION_ACCEPTED,
        title: "Accepted",
        body: "Your application was accepted",
        jobId: "job-1",
        sendPush: false,
      });

      expect(pushSubscriptionService.sendPushNotification).not.toHaveBeenCalled();
    });
  });

  // ─── createJobNotification ─────────────────────────────────────────────

  describe("createJobNotification", () => {
    beforeEach(() => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 1,
          user_address: defaultAddress,
          type: "dispute_opened",
          title: "Dispute filed",
          body: "A dispute was filed",
          read: false,
          job_id: "job-1",
          link_path: "/jobs/job-1",
          created_at: new Date().toISOString(),
        }],
      });
    });

    test("should create with default job link path", async () => {
      const notification = await createJobNotification({
        userAddress: defaultAddress,
        type: EVENT_TYPES.DISPUTE_OPENED,
        title: "Dispute filed",
        body: "A dispute was filed",
        jobId: "job-1",
      });

      expect(notification).toBeDefined();
      expect(notification.linkPath).toContain("/jobs/job-1");
    });
  });

  // ─── listInAppNotifications ────────────────────────────────────────────

  describe("listInAppNotifications", () => {
    beforeEach(() => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            user_address: defaultAddress,
            type: "escrow_created",
            title: "Test",
            body: "Body",
            read: false,
            job_id: null,
            link_path: null,
            created_at: new Date().toISOString(),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ count: 1 }],
        });
    });

    test("should return notifications with unread count", async () => {
      const result = await listInAppNotifications(defaultAddress);
      expect(result.notifications).toHaveLength(1);
      expect(result.unreadCount).toBe(1);
    });

    test("should handle cursor pagination", async () => {
      mockQuery
        .mockReset()
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            user_address: defaultAddress,
            type: "escrow_created",
            title: "Test",
            body: "Body",
            read: false,
            job_id: null,
            link_path: null,
            created_at: "2026-01-01T00:00:00.000Z",
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ count: 0 }],
        });

      const result = await listInAppNotifications(defaultAddress, {
        limit: 10,
        cursor: "2026-01-01T00:00:00.000Z",
      });
      expect(result.notifications).toBeDefined();
    });
  });

  // ─── markInAppNotificationRead ─────────────────────────────────────────

  describe("markInAppNotificationRead", () => {
    test("should mark a notification as read", async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 1,
          user_address: defaultAddress,
          type: "escrow_created",
          title: "Test",
          body: "Body",
          read: true,
          job_id: null,
          link_path: null,
          created_at: new Date().toISOString(),
        }],
      });

      const result = await markInAppNotificationRead(1, defaultAddress);
      expect(result.read).toBe(true);
    });

    test("should throw 404 when notification not found", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        markInAppNotificationRead(999, defaultAddress),
      ).rejects.toThrow("Notification not found");
    });
  });

  // ─── markAllInAppNotificationsRead ─────────────────────────────────────

  describe("markAllInAppNotificationsRead", () => {
    test("should return updated count", async () => {
      mockQuery.mockResolvedValue({ rowCount: 5 });

      const result = await markAllInAppNotificationsRead(defaultAddress);
      expect(result.updatedCount).toBe(5);
    });
  });

  // ─── getUserPreferences ────────────────────────────────────────────────

  describe("getUserPreferences", () => {
    test("should return preferences when profile exists", async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          email: "user@example.com",
          email_notifications_enabled: true,
          webhook_url: "https://hooks.example.com",
          webhook_secret: "secret123",
        }],
      });

      const prefs = await getUserPreferences(defaultAddress);
      expect(prefs.email).toBe("user@example.com");
      expect(prefs.email_notifications_enabled).toBe(true);
    });

    test("should return null when profile not found", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const prefs = await getUserPreferences(defaultAddress);
      expect(prefs).toBeNull();
    });
  });

  // ─── sendEmail ─────────────────────────────────────────────────────────

  describe("sendEmail", () => {
    test("should send email when transport is configured", async () => {
      const sendEmailFn = jest.fn().mockResolvedValue(true);

      const result = await sendEmail(
        { to: "test@example.com", subject: "Test", text: "Hello", html: "<p>Hello</p>" },
        sendEmailFn,
      );

      expect(result).toBe(true);
      expect(sendEmailFn).toHaveBeenCalledWith({
        to: "test@example.com",
        subject: "Test",
        text: "Hello",
        html: "<p>Hello</p>",
      });
    });

    test("should return false when transport is not configured", async () => {
      const result = await sendEmail(
        { to: "test@example.com", subject: "Test", text: "Hello", html: "<p>Hello</p>" },
        null,
      );

      expect(result).toBe(false);
    });

    test("should return false on send failure", async () => {
      const sendEmailFn = jest.fn().mockRejectedValue(new Error("SMTP error"));

      const result = await sendEmail(
        { to: "test@example.com", subject: "Test", text: "Hello", html: "<p>Hello</p>" },
        sendEmailFn,
      );

      expect(result).toBe(false);
    });
  });

  // ─── sendWebhook ───────────────────────────────────────────────────────

  describe("sendWebhook", () => {
    test("should send webhook successfully", async () => {
      axios.post.mockResolvedValue({ status: 200 });

      const result = await sendWebhook({
        url: "https://hooks.example.com",
        secret: "secret123",
        payload: { event: "escrow_created" },
      });

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalled();
    });

    test("should return false on network error", async () => {
      axios.post.mockRejectedValue(new Error("Network error"));

      const result = await sendWebhook({
        url: "https://hooks.example.com",
        secret: "secret123",
        payload: { event: "escrow_created" },
      });

      expect(result).toBe(false);
    });

    test("should include HMAC signature in headers", async () => {
      axios.post.mockResolvedValue({ status: 200 });

      await sendWebhook({
        url: "https://hooks.example.com",
        secret: "testsecret",
        payload: { event: "test" },
      });

      expect(axios.post).toHaveBeenCalledWith(
        "https://hooks.example.com",
        { event: "test" },
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Webhook-Signature": expect.any(String),
            "X-Webhook-Timestamp": expect.any(String),
          }),
        }),
      );
    });
  });

  // ─── processPendingNotifications ───────────────────────────────────────

  describe("processPendingNotifications", () => {
    beforeEach(() => {
      mockQuery.mockReset();
    });

    test("should return stats when no pending notifications", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await processPendingNotifications();

      expect(result).toEqual({ sent: 0, failed: 0, total: 0 });
    });

    test("should skip email when email not enabled", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            recipient_address: defaultAddress,
            notification_type: "email",
            event_type: EVENT_TYPES.ESCROW_CREATED,
            job_id: "job-1",
            payload: { jobTitle: "Test", jobId: "job-1", amount: "100", currency: "XLM" },
            retry_count: 0,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            email: "user@example.com",
            email_notifications_enabled: false,
            webhook_url: null,
            webhook_secret: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await processPendingNotifications(jest.fn());
      expect(result.sent).toBe(1);
    });

    test("should process webhook notifications", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            recipient_address: defaultAddress,
            notification_type: "webhook",
            event_type: EVENT_TYPES.ESCROW_RELEASED,
            job_id: "job-1",
            payload: { jobTitle: "Test", jobId: "job-1", amount: "100", currency: "XLM" },
            retry_count: 0,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            email: null,
            email_notifications_enabled: null,
            webhook_url: "https://hooks.example.com",
            webhook_secret: "secret123",
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      axios.post.mockResolvedValue({ status: 200 });
      const result = await processPendingNotifications();
      expect(result.sent).toBe(1);
    });

    test("should skip webhook when no webhook URL configured", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            recipient_address: defaultAddress,
            notification_type: "webhook",
            event_type: EVENT_TYPES.ESCROW_RELEASED,
            job_id: "job-1",
            payload: { jobTitle: "Test", jobId: "job-1", amount: "100", currency: "XLM" },
            retry_count: 0,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            email: null,
            email_notifications_enabled: null,
            webhook_url: null,
            webhook_secret: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await processPendingNotifications();
      expect(result.sent).toBe(1);
    });

    test("should handle user not found in processPendingNotifications", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            recipient_address: defaultAddress,
            notification_type: "email",
            event_type: EVENT_TYPES.ESCROW_CREATED,
            job_id: "job-1",
            payload: { jobTitle: "Test", jobId: "job-1", amount: "100", currency: "XLM" },
            retry_count: 0,
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await processPendingNotifications();
      expect(result.failed).toBe(1);
    });

    test("should process email notifications successfully", async () => {
      const sendEmailFn = jest.fn().mockResolvedValue(true);

      mockQuery
        // First query: fetch pending
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            recipient_address: defaultAddress,
            notification_type: "email",
            event_type: EVENT_TYPES.ESCROW_CREATED,
            job_id: "job-1",
            payload: { jobTitle: "Test", jobId: "job-1", amount: "100", currency: "XLM" },
            retry_count: 0,
          }],
        })
        // getUserPreferences query (inside processPending)
        .mockResolvedValueOnce({
          rows: [{
            email: "user@example.com",
            email_notifications_enabled: true,
            webhook_url: null,
            webhook_secret: null,
          }],
        })
        // Update to 'sent'
        .mockResolvedValueOnce({ rows: [] });

      const result = await processPendingNotifications(sendEmailFn);

      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);
    });

    test("should dead-letter after max retries", async () => {
      // sendEmailFn that throws will cause sendEmail to return false
      // which triggers the dead-letter path
      const sendEmailFn = jest.fn().mockRejectedValue(new Error("Delivery failed"));

      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            recipient_address: defaultAddress,
            notification_type: "email",
            event_type: EVENT_TYPES.ESCROW_CREATED,
            job_id: "job-1",
            payload: { jobTitle: "Test", jobId: "job-1", amount: "100", currency: "XLM" },
            retry_count: 4, // MAX_RETRIES - 1 → will dead-letter on next attempt
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            email: "user@example.com",
            email_notifications_enabled: true,
            webhook_url: null,
            webhook_secret: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await processPendingNotifications(sendEmailFn);

      expect(result.failed).toBe(1);
    });
  });

  // ─── notifyEscrowEvent ─────────────────────────────────────────────────

  describe("notifyEscrowEvent", () => {
    beforeEach(() => {
      mockQuery.mockReset();
      // queueNotification needs to return rows
      mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    });

    test("should notify both client and freelancer", async () => {
      await notifyEscrowEvent({
        eventType: EVENT_TYPES.ESCROW_CREATED,
        jobId: "job-1",
        clientAddress: defaultAddress,
        freelancerAddress: "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC",
        data: { jobTitle: "Test", amount: "100" },
      });

      // Should have called createInAppNotification 2 times (client + freelancer)
      // and queueNotification 4 times (email+webhook each)
      expect(mockQuery).toHaveBeenCalled();
    });

    test("should notify client only when no freelancer", async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

      await notifyEscrowEvent({
        eventType: EVENT_TYPES.WORK_STARTED,
        jobId: "job-2",
        clientAddress: defaultAddress,
        freelancerAddress: null,
        data: { jobTitle: "Test", amount: "100" },
      });

      // Should have called createInAppNotification 1 time (client only)
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  // ─── sendPushNotificationForEvent ──────────────────────────────────────

  describe("sendPushNotificationForEvent", () => {
    test("should send push for important events", async () => {
      await sendPushNotificationForEvent(defaultAddress, {
        type: EVENT_TYPES.APPLICATION_RECEIVED,
        title: "New application",
        body: "Someone applied",
        jobId: "job-1",
      });

      expect(pushSubscriptionService.sendPushNotification).toHaveBeenCalled();
    });

    test("should NOT send push for non-push events", async () => {
      const result = await sendPushNotificationForEvent(defaultAddress, {
        type: EVENT_TYPES.ESCROW_CREATED,
        title: "Escrow created",
        body: "Escrow was created",
        jobId: "job-1",
      });

      expect(result).toBeNull();
      expect(pushSubscriptionService.sendPushNotification).not.toHaveBeenCalled();
    });

    test("should return null when userAddress is missing", async () => {
      const result = await sendPushNotificationForEvent(null, {
        type: EVENT_TYPES.APPLICATION_RECEIVED,
        title: "New application",
        body: "Someone applied",
      });

      expect(result).toBeNull();
    });

    test("should handle push notification failures gracefully", async () => {
      pushSubscriptionService.sendPushNotification.mockRejectedValue(new Error("Push failed"));

      const result = await sendPushNotificationForEvent(defaultAddress, {
        type: EVENT_TYPES.APPLICATION_RECEIVED,
        title: "New application",
        body: "Someone applied",
        jobId: "job-1",
      });

      // Should still return null, not throw
      expect(result).toBeNull();
    });
  });
});
