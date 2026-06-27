"use strict";

const MOCK_FREELANCERS = [
  {
    public_key: "GFREELANCER1",
    email: "freelancer1@example.com",
    digest_unsubscribe_token: "token-aaa-111",
  },
  {
    public_key: "GFREELANCER2",
    email: "freelancer2@example.com",
    digest_unsubscribe_token: "token-bbb-222",
  },
];

function makeJob(overrides = {}) {
  return {
    id: "job-uuid-001",
    title: "Rust Smart Contract Developer",
    description: "We need an experienced Rust developer to build Soroban contracts.",
    budget: 1500,
    currency: "XLM",
    category: "Blockchain",
    match_score: 87.5,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

module.exports = {
  MOCK_FREELANCERS,
  makeJob,
};
