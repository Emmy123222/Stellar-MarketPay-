"use strict";

const {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLID,
} = require("graphql");

const pool = require("../db/pool");
const jobService = require("../services/jobService");
const { submitApplication } = require("../services/applicationService");
const { createLoaders } = require("./loaders");

const {
  getJob: _getJob,
  listJobs: _listJobs,
  createJob: _createJob,
  updateJobStatus: _updateJobStatus,
} = jobService.default || jobService;

// ── Enums ──────────────────────────────────────────────────────────────────

const JobStatusEnum = new GraphQLEnumType({
  name: "JobStatus",
  values: {
    open: { value: "open" },
    in_progress: { value: "in_progress" },
    completed: { value: "completed" },
    cancelled: { value: "cancelled" },
    disputed: { value: "disputed" },
  },
});

const ApplicationStatusEnum = new GraphQLEnumType({
  name: "ApplicationStatus",
  values: {
    pending: { value: "pending" },
    accepted: { value: "accepted" },
    rejected: { value: "rejected" },
  },
});

// ── Types ──────────────────────────────────────────────────────────────────

const ProfileType = new GraphQLObjectType({
  name: "Profile",
  fields: () => ({
    publicKey: { type: new GraphQLNonNull(GraphQLString) },
    displayName: { type: GraphQLString },
    bio: { type: GraphQLString },
    skills: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    rating: { type: GraphQLFloat },
    completedJobs: { type: new GraphQLNonNull(GraphQLInt) },
  }),
});

const EscrowType = new GraphQLObjectType({
  name: "Escrow",
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    jobId: { type: new GraphQLNonNull(GraphQLString) },
    contractId: { type: new GraphQLNonNull(GraphQLString) },
    amountXlm: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(GraphQLString) },
    releasedAt: { type: GraphQLString },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    updatedAt: { type: new GraphQLNonNull(GraphQLString) },
  }),
});

const ApplicationType = new GraphQLObjectType({
  name: "Application",
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    jobId: { type: new GraphQLNonNull(GraphQLString) },
    freelancerAddress: { type: new GraphQLNonNull(GraphQLString) },
    proposal: { type: new GraphQLNonNull(GraphQLString) },
    bidAmount: { type: new GraphQLNonNull(GraphQLString) },
    currency: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(ApplicationStatusEnum) },
    screeningAnswers: { type: GraphQLString },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    freelancer: {
      type: new GraphQLNonNull(ProfileType),
      resolve: (app, _, ctx) => ctx.loaders.profile.load(app.freelancerAddress),
    },
  }),
});

const ReferralBonusType = new GraphQLObjectType({
  name: "ReferralBonus",
  fields: () => ({
    referrer: { type: new GraphQLNonNull(GraphQLString) },
    bonusXlm: { type: new GraphQLNonNull(GraphQLString) },
  }),
});

const JobType = new GraphQLObjectType({
  name: "Job",
  fields: () => ({
    id: { type: new GraphQLNonNull(GraphQLID) },
    title: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
    budget: { type: new GraphQLNonNull(GraphQLString) },
    currency: { type: new GraphQLNonNull(GraphQLString) },
    category: { type: new GraphQLNonNull(GraphQLString) },
    skills: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    status: { type: new GraphQLNonNull(JobStatusEnum) },
    visibility: { type: new GraphQLNonNull(GraphQLString) },
    clientAddress: { type: new GraphQLNonNull(GraphQLString) },
    freelancerAddress: { type: GraphQLString },
    escrowContractId: { type: GraphQLString },
    applicantCount: { type: new GraphQLNonNull(GraphQLInt) },
    shareCount: { type: new GraphQLNonNull(GraphQLInt) },
    boosted: { type: new GraphQLNonNull(GraphQLBoolean) },
    deadline: { type: GraphQLString },
    timezone: { type: GraphQLString },
    createdAt: { type: new GraphQLNonNull(GraphQLString) },
    updatedAt: { type: new GraphQLNonNull(GraphQLString) },
    client: {
      type: new GraphQLNonNull(ProfileType),
      resolve: (job, _, ctx) => ctx.loaders.profile.load(job.clientAddress),
    },
    freelancer: {
      type: ProfileType,
      resolve: (job, _, ctx) =>
        job.freelancerAddress ? ctx.loaders.profile.load(job.freelancerAddress) : null,
    },
    escrow: {
      type: EscrowType,
      resolve: (job, _, ctx) => ctx.loaders.escrowByJob.load(job.id),
    },
    applications: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ApplicationType))),
      resolve: (job, _, ctx) => ctx.loaders.applicationsByJob.load(job.id),
    },
  }),
});

const JobPageType = new GraphQLObjectType({
  name: "JobPage",
  fields: () => ({
    jobs: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(JobType))) },
    nextCursor: { type: GraphQLString },
  }),
});

const ReleaseResultType = new GraphQLObjectType({
  name: "ReleaseResult",
  fields: () => ({
    success: { type: new GraphQLNonNull(GraphQLBoolean) },
    message: { type: new GraphQLNonNull(GraphQLString) },
    referralBonus: { type: ReferralBonusType },
  }),
});

// ── Input types ────────────────────────────────────────────────────────────

const JobFilterInput = new GraphQLInputObjectType({
  name: "JobFilter",
  fields: () => ({
    category: { type: GraphQLString },
    status: { type: GraphQLString },
    limit: { type: GraphQLInt },
    search: { type: GraphQLString },
    cursor: { type: GraphQLString },
  }),
});

const CreateJobInput = new GraphQLInputObjectType({
  name: "CreateJobInput",
  fields: () => ({
    title: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
    budget: { type: new GraphQLNonNull(GraphQLString) },
    currency: { type: GraphQLString },
    category: { type: new GraphQLNonNull(GraphQLString) },
    skills: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
    deadline: { type: GraphQLString },
    timezone: { type: GraphQLString },
    clientAddress: { type: new GraphQLNonNull(GraphQLString) },
  }),
});

const ApplyToJobInput = new GraphQLInputObjectType({
  name: "ApplyToJobInput",
  fields: () => ({
    jobId: { type: new GraphQLNonNull(GraphQLID) },
    freelancerAddress: { type: new GraphQLNonNull(GraphQLString) },
    proposal: { type: new GraphQLNonNull(GraphQLString) },
    bidAmount: { type: new GraphQLNonNull(GraphQLString) },
    currency: { type: GraphQLString },
  }),
});

// ── Query ──────────────────────────────────────────────────────────────────

const QueryType = new GraphQLObjectType({
  name: "Query",
  fields: () => ({
    job: {
      type: JobType,
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: async (_, { id }) => {
        return _getJob(id);
      },
    },
    jobs: {
      type: new GraphQLNonNull(JobPageType),
      args: { filter: { type: JobFilterInput } },
      resolve: async (_, { filter }) => {
        const opts = filter || {};
        const result = await _listJobs({
          category: opts.category,
          status: opts.status,
          limit: opts.limit || 20,
          search: opts.search,
          cursor: opts.cursor,
        });
        return { jobs: result.jobs, nextCursor: result.nextCursor };
      },
    },
    profile: {
      type: ProfileType,
      args: { publicKey: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: async (_, { publicKey }) => {
        const { getProfile } = require("../services/profileService");
        return getProfile(publicKey);
      },
    },
    escrow: {
      type: EscrowType,
      args: { jobId: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: async (_, { jobId }) => {
        const { rows } = await pool.query(
          "SELECT * FROM escrows WHERE job_id = $1",
          [jobId],
        );
        if (!rows.length) return null;
        return {
          id: rows[0].id,
          jobId: rows[0].job_id,
          contractId: rows[0].contract_id,
          amountXlm: String(rows[0].amount_xlm),
          status: rows[0].status,
          releasedAt: rows[0].released_at || null,
          createdAt: rows[0].created_at,
          updatedAt: rows[0].updated_at,
        };
      },
    },
  }),
});

// ── Mutation ───────────────────────────────────────────────────────────────

const MutationType = new GraphQLObjectType({
  name: "Mutation",
  fields: () => ({
    createJob: {
      type: new GraphQLNonNull(JobType),
      args: {
        input: { type: new GraphQLNonNull(CreateJobInput) },
      },
      resolve: async (_, { input }) => {
        return _createJob(input);
      },
    },
    applyToJob: {
      type: new GraphQLNonNull(ApplicationType),
      args: {
        input: { type: new GraphQLNonNull(ApplyToJobInput) },
      },
      resolve: async (_, { input }) => {
        const app = await submitApplication({
          jobId: input.jobId,
          freelancerAddress: input.freelancerAddress,
          proposal: input.proposal,
          bidAmount: input.bidAmount,
          currency: input.currency || "XLM",
        });
        return app;
      },
    },
    releaseEscrow: {
      type: new GraphQLNonNull(ReleaseResultType),
      args: {
        jobId: { type: new GraphQLNonNull(GraphQLID) },
        clientAddress: { type: new GraphQLNonNull(GraphQLString) },
        contractTxHash: { type: GraphQLString },
      },
      resolve: async (_, { jobId, clientAddress, contractTxHash }) => {
        const job = await _getJob(jobId);

        if (job.clientAddress !== clientAddress) {
          throw Object.assign(new Error("Only the job client can release escrow"), { status: 403 });
        }
        if (job.status !== "in_progress") {
          throw Object.assign(new Error("Job is not in progress"), { status: 400 });
        }

        const { rows: escrowRows } = await pool.query(
          `UPDATE escrows
           SET status = 'released', released_at = NOW(), updated_at = NOW()
           WHERE job_id = $1
           RETURNING amount_xlm`,
          [jobId],
        );

        await _updateJobStatus(jobId, "completed");

        const { processReferralPayout } = require("../services/referralService");
        const amountXlm = escrowRows.length ? escrowRows[0].amount_xlm : "0";
        const referralResult = await processReferralPayout(
          jobId,
          job.freelancerAddress,
          amountXlm,
          contractTxHash || null,
        );

        return {
          success: true,
          message: "Escrow released and job completed",
          referralBonus: referralResult
            ? { referrer: referralResult.referrer, bonusXlm: referralResult.bonusXlm }
            : null,
        };
      },
    },
  }),
});

// ── Schema ─────────────────────────────────────────────────────────────────

const schema = new GraphQLSchema({
  query: QueryType,
  mutation: MutationType,
});

module.exports = schema;
