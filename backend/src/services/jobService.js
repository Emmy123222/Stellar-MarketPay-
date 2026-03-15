/**
 * src/services/jobService.js
 */
"use strict";

const { v4: uuid } = require("uuid");
const { jobs, applications } = require("./store");

const VALID_STATUSES   = ["open", "in_progress", "completed", "cancelled"];
const VALID_CATEGORIES = [
  "Smart Contracts","Frontend Development","Backend Development",
  "UI/UX Design","Technical Writing","DevOps",
  "Security Audit","Data Analysis","Mobile Development","Other",
];

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key"); e.status = 400; throw e;
  }
}

/**
 * Create a new job listing.
 */
function createJob({ title, description, budget, category, skills, deadline, clientAddress }) {
  validatePublicKey(clientAddress);

  if (!title || title.length < 10)        { const e = new Error("Title must be at least 10 characters"); e.status = 400; throw e; }
  if (!description || description.length < 30) { const e = new Error("Description must be at least 30 characters"); e.status = 400; throw e; }
  if (!budget || isNaN(parseFloat(budget)) || parseFloat(budget) <= 0) { const e = new Error("Budget must be a positive number"); e.status = 400; throw e; }
  if (!VALID_CATEGORIES.includes(category)) { const e = new Error("Invalid category"); e.status = 400; throw e; }

  const job = {
    id:               uuid(),
    title:            title.trim(),
    description:      description.trim(),
    budget:           parseFloat(budget).toFixed(7),
    category,
    skills:           Array.isArray(skills) ? skills.slice(0, 8) : [],
    status:           "open",
    clientAddress,
    freelancerAddress: null,
    escrowContractId: null,
    applicantCount:   0,
    deadline:         deadline || null,
    createdAt:        new Date().toISOString(),
    updatedAt:        new Date().toISOString(),
  };

  jobs.set(job.id, job);
  return job;
}

function getJob(id) {
  const job = jobs.get(id);
  if (!job) { const e = new Error("Job not found"); e.status = 404; throw e; }
  return job;
}

function listJobs({ category, status = "open", limit = 50 } = {}) {
  let result = Array.from(jobs.values());
  if (status && VALID_STATUSES.includes(status)) result = result.filter(j => j.status === status);
  if (category) result = result.filter(j => j.category === category);
  return result
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Math.min(limit, 100));
}

function listJobsByClient(clientAddress) {
  validatePublicKey(clientAddress);
  return Array.from(jobs.values())
    .filter(j => j.clientAddress === clientAddress)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateJobStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) { const e = new Error("Invalid status"); e.status = 400; throw e; }
  const job = getJob(id);
  job.status    = status;
  job.updatedAt = new Date().toISOString();
  jobs.set(id, job);
  return job;
}

function assignFreelancer(jobId, freelancerAddress) {
  validatePublicKey(freelancerAddress);
  const job = getJob(jobId);
  job.freelancerAddress = freelancerAddress;
  job.status            = "in_progress";
  job.updatedAt         = new Date().toISOString();
  jobs.set(jobId, job);
  return job;
}

module.exports = { createJob, getJob, listJobs, listJobsByClient, updateJobStatus, assignFreelancer };
