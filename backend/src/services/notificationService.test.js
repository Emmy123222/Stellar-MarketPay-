/**
 * src/services/notificationService.test.js
 * Tests for notification service
 */
"use strict";

// Mock the database pool before requiring the service
jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const {
  generateEmailContent,
  EVENT_TYPES,
} = require("./notificationService");

describe("Notification Service", () => {
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
      expect(content.subject).toContain(mockData.jobTitle);
      expect(content.text).toContain("Work has started");
      expect(content.html).toContain("Work Started");
    });

    test("should generate ESCROW_RELEASED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.ESCROW_RELEASED, mockData);
      
      expect(content.subject).toContain("Payment Released");
      expect(content.subject).toContain(mockData.jobTitle);
      expect(content.text).toContain("Payment for");
      expect(content.text).toContain("has been released");
      expect(content.html).toContain("Payment Released");
    });

    test("should generate REFUND_ISSUED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.REFUND_ISSUED, mockData);
      
      expect(content.subject).toContain("Refund Issued");
      expect(content.text).toContain("refund");
      expect(content.text).toContain("has been issued");
      expect(content.html).toContain("Refund Issued");
    });

    test("should generate DISPUTE_OPENED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.DISPUTE_OPENED, mockData);
      
      expect(content.subject).toContain("Dispute Opened");
      expect(content.text).toContain("dispute has been opened");
      expect(content.html).toContain("Dispute Opened");
    });

    test("should generate APPLICATION_ACCEPTED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.APPLICATION_ACCEPTED, mockData);
      
      expect(content.subject).toContain("Application Accepted");
      expect(content.text).toContain("application");
      expect(content.text).toContain("has been accepted");
      expect(content.html).toContain("Application Accepted");
    });

    test("should generate JOB_COMPLETED email content", () => {
      const content = generateEmailContent(EVENT_TYPES.JOB_COMPLETED, mockData);
      
      expect(content.subject).toContain("Job Completed");
      expect(content.text).toContain("has been completed");
      expect(content.html).toContain("Job Completed");
    });

    test("should include job URL in all emails", () => {
      const events = [
        EVENT_TYPES.ESCROW_CREATED,
        EVENT_TYPES.WORK_STARTED,
        EVENT_TYPES.ESCROW_RELEASED,
        EVENT_TYPES.REFUND_ISSUED,
        EVENT_TYPES.DISPUTE_OPENED,
        EVENT_TYPES.APPLICATION_ACCEPTED,
        EVENT_TYPES.JOB_COMPLETED,
      ];

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

    test("should include job title in emails", () => {
      const dataWithSpecialChars = {
        ...mockData,
        jobTitle: "Build App & Test <Features>",
      };
      
      const content = generateEmailContent(EVENT_TYPES.ESCROW_CREATED, dataWithSpecialChars);
      
      // Job title should be included in both text and HTML versions
      expect(content.text).toContain(dataWithSpecialChars.jobTitle);
      expect(content.html).toContain(dataWithSpecialChars.jobTitle);
    });
  });

  describe("EVENT_TYPES", () => {
    test("should export all required event types", () => {
      expect(EVENT_TYPES.ESCROW_CREATED).toBe("escrow_created");
      expect(EVENT_TYPES.WORK_STARTED).toBe("work_started");
      expect(EVENT_TYPES.ESCROW_RELEASED).toBe("escrow_released");
      expect(EVENT_TYPES.REFUND_ISSUED).toBe("refund_issued");
      expect(EVENT_TYPES.DISPUTE_OPENED).toBe("dispute_opened");
      expect(EVENT_TYPES.APPLICATION_ACCEPTED).toBe("application_accepted");
      expect(EVENT_TYPES.JOB_COMPLETED).toBe("job_completed");
    });
  });
});
