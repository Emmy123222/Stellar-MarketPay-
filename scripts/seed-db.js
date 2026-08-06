#!/usr/bin/env node
"use strict";

/**
 * Database seeding script for development environment.
 *
 * Seeds:
 * - 5 users (mix of clients and freelancers)
 * - 20 open jobs
 * - 10 applications
 * - 3 in-progress jobs with escrow
 *
 * This script is idempotent - running it multiple times will not create duplicates.
 */

const { Pool } = require("pg");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables from backend directory
dotenv.config({ path: path.join(__dirname, "..", "backend", ".env") });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is not set");
  console.error("Please ensure backend/.env exists with DATABASE_URL configured");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Seed data
const USERS = [
  {
    public_key: "GCLIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    display_name: "Alice Client",
    bio: "Experienced product manager looking for skilled developers",
    skills: ["project-management", "agile", "product-design"],
    role: "client",
    email: "alice@example.com",
  },
  {
    public_key: "GCLIENT2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    display_name: "Bob Startup",
    bio: "Startup founder seeking blockchain developers",
    skills: ["entrepreneurship", "blockchain"],
    role: "client",
    email: "bob@example.com",
  },
  {
    public_key: "GFREE1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    display_name: "Charlie Developer",
    bio: "Full-stack developer with 5 years experience",
    skills: ["javascript", "react", "nodejs", "postgresql"],
    role: "freelancer",
    email: "charlie@example.com",
  },
  {
    public_key: "GFREE2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    display_name: "Diana Designer",
    bio: "UI/UX designer specializing in modern web interfaces",
    skills: ["figma", "ui-design", "ux-research", "css"],
    role: "freelancer",
    email: "diana@example.com",
  },
  {
    public_key: "GFREE3XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    display_name: "Eve Engineer",
    bio: "Backend engineer and blockchain enthusiast",
    skills: ["solidity", "rust", "stellar", "smart-contracts"],
    role: "freelancer",
    email: "eve@example.com",
  },
];

const JOB_TITLES = [
  "Build a React dashboard for analytics",
  "Design modern landing page for SaaS",
  "Develop Stellar smart contract for escrow",
  "Create mobile app UI components",
  "Implement real-time chat feature",
  "Build REST API for e-commerce platform",
  "Design logo and brand identity",
  "Develop blockchain wallet integration",
  "Create responsive email templates",
  "Build payment processing system",
  "Design user onboarding flow",
  "Develop NFT marketplace backend",
  "Create admin dashboard with charts",
  "Implement authentication system",
  "Design marketing website",
  "Build GraphQL API for content management",
  "Develop file upload service",
  "Create notification system",
  "Design mobile app prototype",
  "Build data pipeline for analytics",
];

const JOB_DESCRIPTIONS = [
  "Looking for an experienced developer to build a comprehensive analytics dashboard with real-time data visualization.",
  "Need a modern, clean landing page design for our SaaS product. Must be responsive and conversion-optimized.",
  "Seeking a blockchain developer to create a Stellar smart contract for escrow functionality in our marketplace.",
  "Design and implement reusable mobile app UI components following modern design principles.",
  "Build a real-time chat feature using WebSockets with support for private and group conversations.",
  "Develop a robust REST API for an e-commerce platform with product management and order processing.",
  "Create a complete brand identity including logo, color palette, and typography guidelines.",
  "Integrate Stellar blockchain wallet functionality into our existing web application.",
  "Design responsive HTML email templates that work across all major email clients.",
  "Build a secure payment processing system with support for multiple payment methods.",
  "Design an intuitive user onboarding flow that increases user activation rates.",
  "Develop the backend infrastructure for an NFT marketplace using Stellar blockchain.",
  "Create an admin dashboard with interactive charts and data visualization tools.",
  "Implement a secure authentication system with JWT tokens and role-based access control.",
  "Design a modern marketing website with compelling copy and strong visual hierarchy.",
  "Build a GraphQL API for a headless content management system.",
  "Develop a scalable file upload service with support for multiple file types.",
  "Create a multi-channel notification system with email, push, and in-app notifications.",
  "Design high-fidelity mobile app prototypes for user testing and validation.",
  "Build a data pipeline to collect, process, and analyze user behavior data.",
];

async function seedUsers() {
  console.log("Seeding users...");

  for (const user of USERS) {
    await pool.query(
      `INSERT INTO profiles (public_key, display_name, bio, skills, role, email, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (public_key) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         bio = EXCLUDED.bio,
         skills = EXCLUDED.skills,
         role = EXCLUDED.role,
         email = EXCLUDED.email,
         updated_at = NOW()`,
      [user.public_key, user.display_name, user.bio, user.skills, user.role, user.email]
    );
  }

  console.log(`Seeded ${USERS.length} users`);
}

async function seedOpenJobs() {
  console.log("Seeding open jobs...");

  const clients = USERS.filter((u) => u.role === "client");
  const categories = ["smart-contracts", "frontend-development", "backend-development", "ui-ux-design", "other"];

  let insertedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < 20; i++) {
    const client = clients[i % clients.length];
    const category = categories[i % categories.length];

    // Idempotency guard: this seed data has fixed, known titles, so an
    // existing job with the same title means this seed row was already
    // inserted on a prior run. Skip it instead of inserting a duplicate.
    const existing = await pool.query(
      "SELECT id FROM jobs WHERE title = $1",
      [JOB_TITLES[i]]
    );
    if (existing.rows.length > 0) {
      skippedCount += 1;
      continue;
    }

    // Get category_id from categories table
    const categoryResult = await pool.query(
      "SELECT id FROM categories WHERE slug = $1",
      [category]
    );
    const categoryId = categoryResult.rows[0]?.id;

    await pool.query(
      `INSERT INTO jobs (
        id, title, description, budget, currency, category, category_id,
        status, client_address, created_at, updated_at, visibility
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, 'XLM', $4, $5, 'open', $6, NOW(), NOW(), 'public'
      )`,
      [
        JOB_TITLES[i],
        JOB_DESCRIPTIONS[i],
        100 + (i * 50), // Budget from 100 to 1050 XLM
        category,
        categoryId,
        client.public_key,
      ]
    );
    insertedCount += 1;
  }

  console.log(`Seeded 20 open jobs (${insertedCount} inserted, ${skippedCount} already present)`);
}

async function seedApplications() {
  console.log("Seeding applications...");

  const freelancers = USERS.filter((u) => u.role === "freelancer");

  // Get open jobs
  const jobsResult = await pool.query(
    "SELECT id FROM jobs WHERE status = 'open' LIMIT 10"
  );

  const jobs = jobsResult.rows;

  for (let i = 0; i < Math.min(10, jobs.length); i++) {
    const freelancer = freelancers[i % freelancers.length];
    const job = jobs[i];

    await pool.query(
      `INSERT INTO applications (job_id, freelancer_address, proposal, bid_amount, status, created_at)
      VALUES ($1, $2, $3, $4, 'pending', NOW())
      ON CONFLICT (job_id, freelancer_address) DO NOTHING`,
      [
        job.id,
        freelancer.public_key,
        `I am interested in this job and have the relevant skills to complete it successfully.`,
        50 + (i * 25), // Bid from 50 to 275 XLM
      ]
    );
  }

  console.log("Seeded 10 applications");
}

async function seedInProgressJobs() {
  console.log("Seeding in-progress jobs with escrow...");

  const clients = USERS.filter((u) => u.role === "client");
  const freelancers = USERS.filter((u) => u.role === "freelancer");

  let insertedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < 3; i++) {
    const client = clients[i % clients.length];
    const freelancer = freelancers[i % freelancers.length];
    const title = `In-progress job ${i + 1}`;

    // Idempotency guard: same approach as seedOpenJobs - these titles are
    // fixed per seed run, so an existing match means this row already exists.
    const existing = await pool.query(
      "SELECT id FROM jobs WHERE title = $1",
      [title]
    );

    if (existing.rows.length > 0) {
      const jobId = existing.rows[0].id;

      // Ensure the escrow record exists even if the job row was already
      // there (e.g. a prior partial run left the job but not the escrow).
      await pool.query(
        `INSERT INTO escrows (job_id, contract_id, amount_xlm, milestones, status, created_at, updated_at)
        VALUES ($1, $2, $3, '[]'::jsonb, 'funded', NOW(), NOW())
        ON CONFLICT (job_id) DO NOTHING`,
        [
          jobId,
          `CONTRACT_${i + 1}_${Date.now()}`,
          200 + (i * 100),
        ]
      );

      skippedCount += 1;
      continue;
    }

    // Create in-progress job
    const jobResult = await pool.query(
      `INSERT INTO jobs (
        id, title, description, budget, currency, category, category_id,
        status, client_address, freelancer_address, created_at, updated_at, visibility
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, 'XLM', 'other',
        (SELECT id FROM categories WHERE slug = 'other'),
        'in_progress', $4, $5, NOW(), NOW(), 'public'
      )
      RETURNING id`,
      [
        title,
        `This is an in-progress job with escrow funding. Currently being worked on by a freelancer.`,
        200 + (i * 100),
        client.public_key,
        freelancer.public_key,
      ]
    );

    const jobId = jobResult.rows[0].id;

    // Create escrow record
    await pool.query(
      `INSERT INTO escrows (job_id, contract_id, amount_xlm, milestones, status, created_at, updated_at)
      VALUES ($1, $2, $3, '[]'::jsonb, 'funded', NOW(), NOW())
      ON CONFLICT (job_id) DO UPDATE SET
        contract_id = EXCLUDED.contract_id,
        amount_xlm = EXCLUDED.amount_xlm,
        status = EXCLUDED.status,
        updated_at = NOW()`,
      [
        jobId,
        `CONTRACT_${i + 1}_${Date.now()}`,
        200 + (i * 100),
      ]
    );

    insertedCount += 1;
  }

  console.log(`Seeded 3 in-progress jobs with escrow (${insertedCount} inserted, ${skippedCount} already present)`);
}

async function main() {
  try {
    console.log("Starting database seeding...");
    console.log(`Database: ${DATABASE_URL.replace(/:[^:]*@/, ":****@")}`);

    await pool.connect();

    await seedUsers();
    await seedOpenJobs();
    await seedApplications();
    await seedInProgressJobs();

    console.log("\nDatabase seeding completed successfully!");
    console.log("\nSummary:");
    console.log("  - 5 users (2 clients, 3 freelancers)");
    console.log("  - 20 open jobs");
    console.log("  - 10 applications");
    console.log("  - 3 in-progress jobs with escrow");
  } catch (error) {
    console.error("Error during seeding:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { seedUsers, seedOpenJobs, seedApplications, seedInProgressJobs };