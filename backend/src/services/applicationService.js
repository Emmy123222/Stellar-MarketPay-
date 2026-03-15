/**
 * src/services/applicationService.js
 */
"use strict";

const { v4: uuid } = require("uuid");
const { applications } = require("./store");
const { getJob, assignFreelancer } = require("./jobService");

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key"); e.status = 400; throw e;
  }
}

function submitApplication({ jobId, freelancerAddress, proposal, bidAmount }) {
  validatePublicKey(freelancerAddress);

  const job = getJob(jobId);
  if (job.status !== "open") { const e = new Error("Job is not open for applications"); e.status = 400; throw e; }
  if (job.clientAddress === freelancerAddress) { const e = new Error("You cannot apply to your own job"); e.status = 400; throw e; }
  if (!proposal || proposal.length < 50) { const e = new Error("Proposal must be at least 50 characters"); e.status = 400; throw e; }
  if (!bidAmount || isNaN(parseFloat(bidAmount)) || parseFloat(bidAmount) <= 0) { const e = new Error("Bid must be a positive number"); e.status = 400; throw e; }

  // Check duplicate application
  const existing = Array.from(applications.values()).find(
    a => a.jobId === jobId && a.freelancerAddress === freelancerAddress
  );
  if (existing) { const e = new Error("You have already applied to this job"); e.status = 409; throw e; }

  const app = {
    id:                uuid(),
    jobId,
    freelancerAddress,
    proposal:          proposal.trim(),
    bidAmount:         parseFloat(bidAmount).toFixed(7),
    status:            "pending",
    createdAt:         new Date().toISOString(),
  };

  applications.set(app.id, app);

  // Increment applicant count on job
  const j = getJob(jobId);
  j.applicantCount = (j.applicantCount || 0) + 1;

  return app;
}

function getApplicationsForJob(jobId) {
  return Array.from(applications.values())
    .filter(a => a.jobId === jobId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getApplicationsForFreelancer(freelancerAddress) {
  validatePublicKey(freelancerAddress);
  return Array.from(applications.values())
    .filter(a => a.freelancerAddress === freelancerAddress)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function acceptApplication(applicationId, clientAddress) {
  validatePublicKey(clientAddress);

  const app = applications.get(applicationId);
  if (!app) { const e = new Error("Application not found"); e.status = 404; throw e; }

  const job = getJob(app.jobId);
  if (job.clientAddress !== clientAddress) { const e = new Error("Only the job client can accept applications"); e.status = 403; throw e; }
  if (job.status !== "open") { const e = new Error("Job is no longer accepting applications"); e.status = 400; throw e; }

  // Accept this application
  app.status = "accepted";
  applications.set(applicationId, app);

  // Reject all other applications for this job
  for (const [id, a] of applications) {
    if (a.jobId === app.jobId && id !== applicationId && a.status === "pending") {
      a.status = "rejected";
      applications.set(id, a);
    }
  }

  // Assign freelancer to job
  assignFreelancer(app.jobId, app.freelancerAddress);

  return app;
}

module.exports = { submitApplication, getApplicationsForJob, getApplicationsForFreelancer, acceptApplication };
