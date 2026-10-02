/**
 * src/routes/jobTemplates.test.js
 * Tests for Client Job Templates (Issue #1556)
 */
"use strict";

const request = require("supertest");
const app = require("../server");
const pool = require("../db/pool");

describe("Job Templates Library (Issue #1556)", () => {
  const clientA = "GBTESTCLIENTA1111111111111111111111111111111111111111111";
  const clientB = "GBTESTCLIENTB2222222222222222222222222222222222222222222";

  const mockTemplates = [
    {
      id: "tpl-1",
      client_address: clientA,
      name: "React Monthly Template",
      title: "Monthly React component work",
      description: "Build reusable React components",
      category: "Frontend Development",
      budget: 150,
      currency: "XLM",
      skills: ["React", "TypeScript"],
      screening_questions: ["Years of React experience?"],
      milestones: [{ description: "Delivery 1", amount: 150 }],
      visibility: "public",
      is_recurring: false,
      interval_days: "30",
      total_releases: "12",
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];

  beforeAll(() => {
    jest.spyOn(pool, "query").mockImplementation(async (sql, params) => {
      const sqlStr = typeof sql === "string" ? sql : sql.text;

      // INSERT INTO job_templates
      if (sqlStr.includes("INSERT INTO job_templates")) {
        const row = {
          id: "tpl-new",
          clientAddress: params[0],
          name: params[1],
          title: params[2],
          description: params[3],
          category: params[4],
          budget: params[5],
          currency: params[6],
          skills: params[7],
          screeningQuestions: JSON.parse(params[8]),
          milestones: JSON.parse(params[9]),
          visibility: params[10],
          isRecurring: params[11],
          intervalDays: params[12],
          totalReleases: params[13],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return { rows: [row] };
      }

      // SELECT FROM job_templates WHERE client_address = $1
      if (sqlStr.includes("FROM job_templates") && sqlStr.includes("client_address = $1")) {
        const client = params[0];
        const rows = mockTemplates.filter((t) => t.client_address === client);
        return {
          rows: rows.map((r) => ({
            id: r.id,
            clientAddress: r.client_address,
            name: r.name,
            title: r.title,
            description: r.description,
            category: r.category,
            budget: r.budget,
            currency: r.currency,
            skills: r.skills,
            screeningQuestions: r.screening_questions,
            milestones: r.milestones,
            visibility: r.visibility,
            isRecurring: r.is_recurring,
            intervalDays: r.interval_days,
            totalReleases: r.total_releases,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          })),
        };
      }

      // DELETE FROM job_templates
      if (sqlStr.includes("DELETE FROM job_templates")) {
        return { rowCount: 1 };
      }

      return { rows: [] };
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("POST /api/job-templates", () => {
    it("creates a job template for client A", async () => {
      const res = await request(app)
        .post("/api/job-templates")
        .set("x-client-address", clientA)
        .send({
          name: "React Monthly Template",
          title: "Monthly React component work",
          description: "Build reusable React components",
          category: "Frontend Development",
          budget: 150,
          currency: "XLM",
          skills: ["React", "TypeScript"],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("React Monthly Template");
      expect(res.body.data.clientAddress).toBe(clientA);
    });

    it("rejects creation if name is missing", async () => {
      const res = await request(app)
        .post("/api/job-templates")
        .set("x-client-address", clientA)
        .send({
          title: "Missing name job",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Template name is required");
    });
  });

  describe("GET /api/job-templates", () => {
    it("returns templates for client A", async () => {
      const res = await request(app)
        .get("/api/job-templates")
        .set("x-client-address", clientA);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe("React Monthly Template");
    });

    it("enforces privacy: returns empty list for client B with no templates", async () => {
      const res = await request(app)
        .get("/api/job-templates")
        .set("x-client-address", clientB);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });
  });
});
