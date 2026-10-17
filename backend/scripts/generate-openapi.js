/*
 * scripts/generate-openapi.js
 * Script to generate OpenAPI specification from JSDoc annotations
 * Outputs both openapi.json and openapi.yaml in docs/
 */

const fs = require('fs');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

// Load swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Stellar MarketPay API',
      version: '1.0.0',
      description: `Backend API for Stellar MarketPay - A decentralized freelance marketplace built on the Stellar blockchain.

## Authentication
Most endpoints require JWT authentication obtained via the **/api/auth** challenge-response flow using Stellar wallet signatures.

## Pagination
List endpoints support cursor-based pagination via the \`after\` query parameter. Responses include \`next_cursor\` and \hhas_more\` fields.`,
      contact: {
        name: 'Stellar MarketPay Team',
        email: 'support@stellarmarketpay.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:4000',
        description: 'Development server'
      },
      {
        url: 'https://api.stellarmarketpay.com',
        description: 'Production server'
      }
    ],
    tags: [
      { name: 'Health', description: 'Health check and monitoring endpoints' },
      { name: 'Authentication', description: 'Stellar wallet-based authentication' },
      { name: 'Jobs', description: 'Job listing CRUD and management' },
      { name: 'Applications', description: 'Job application submission and management' },
      { name: 'Profiles', description: 'User profile management' },
      { name: 'Onboarding', description: 'User onboarding progress tracking' },
      { name: 'Escrow', description: 'Escrow management (release, refund, milestones)' },
      { name: 'Ratings', description: 'User rating and review system' },
      { name: 'Progress', description: 'Job progress tracking' },
      { name: 'Messages', description: 'In-app messaging between users' },
      { name: 'Insights', description: 'Platform analytics and insights' },
      { name: 'Notifications', description: 'Push/in-app notification management' },
      { name: 'WebAuthn1', description: 'Passkey/WebAuthn authentication' },
      { name: 'Disputes', description: 'Dispute evidence and resolution' },
      { name: 'Admin', description: 'Admin-only moderation and analytics' },
      { name: 'Admin 2FA', description: 'Admin two-factor authentication' },
      { name: 'Developer', description: 'API key management for developers' },
      { name: 'Public API', description: 'Public API endpoints (requires API key)' },
      { name: 'Time Entries', description: 'Time tracking and invoicing' },
      { name: 'Referrals', description: 'Referral program management' },
      { name: 'Events', description: 'Contract event indexing' },
      { name: 'Invitations', description: 'Job invitation system' },
      { name: 'Stats', description: 'Platform statistics' },
      { name: 'Gas', description: 'Soroban gas fee estimation' },
      { name: 'Transactions', description: 'Transaction history export' },
      { name: 'DAO', description: 'DAO governance (proposals, voting, treasury)' },
      { name: 'Proposal Templates', description: 'Proposal template management' },
      { name: 'Tokens', description: 'Stellar token registry and metadata' },
      { name: 'Categories', description: 'Job category tree' },
      { name: 'Skills', description: 'Skill autocomplete' },
      { name: 'Faucet', description: 'Testnet XLM faucet' },
      { name: '2FA', description: 'Two-factor authentication (TOTP)' },
      { name: 'Audit', description: 'Audit log access' },
      { name: 'Scope', description: 'Collaborative scope session management' },
      { name: 'Utility', description: 'Utility endpoints (rate limit, CSRF)' },
      { name: 'Verification', description: 'Email, phone, and ID verification' },
      { name: 'Contributors', description: 'GitHub contributor fetching' },
      { name: 'Saved Searches', description: 'Saved job search alerts' },
      { name: 'Assessments', description: 'Skill assessments and certificates' },
      { name: 'AI Scorer', description: 'AI-powered job description scoring' },
      { name: 'NFT', description: 'NFT minting for job completion certificates' },
      { name: 'Certificates', description: 'Skill certificates' },
      { name: 'Turrets', description: 'Stellar Turrets for serverless contract execution' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth (Stellar wallet signature)'
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'jwt',
          description: 'JWT cookie set after authentication'
        },
        apiKeyHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Developer API key for public API endpoints'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          description: 'Structured API error response',
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', description: 'Machine-readable error code', example: 'JOB_NOT_FOUND' },
                message: { type: 'string', description: 'Human-readable error message', example: 'Job not found' },
                details: { description: 'Optional additional context', nullable: true }
              }
            }
          }
        },
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Job ID' },
            title: { type: 'string', description: 'Job title' },
            description: { type: 'string', description: 'Job description' },
            budget: { type: 'number', description: 'Job budget in XLM' },
            clientAddress: { type: 'string', description: 'Client Stellar address' },
            freelancerAddress: { type: 'string', description: 'Assigned freelancer address', nullable: true },
            status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'cancelled', 'expired', 'disputed'], description: 'Job status' },
            category: { type: 'string', description: 'Job category' },
            skills: { type: 'array', items: { type: 'string' }, description: 'Required skills' },
            currency: { type: 'string', description: 'Payment currency', default: 'XLM' },
            visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        },
        Application: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            freelancerAddress: { type: 'string' },
            proposal: { type: 'string' },
            bidAmount: { type: 'number' },
            estimatedDuration: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'withdrawn'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Profile: {
          type: 'object',
          properties: {
            publicKey: { type: 'string', description: 'Stellar public key' },
            displayName: { type: 'string', description: 'Display name' },
            bio: { type: 'string', description: 'User biography' },
            role: { type: 'string', enum: ['freelancer', 'client', 'both'] },
            skills: { type: 'array', items: { type: 'string' } },
            rating: { type: 'number', description: 'Average rating (1-5)' },
            totalEarnedXlm: { type: 'number' },
            completedJobs: { type: 'integer' },
            availability: { type: 'string', enum: ['available', 'busy', 'unavailable'] },
            email: { type: 'string', format: 'email' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Escrow: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            amountXlm: { type: 'number' },
            status: { type: 'string', enum: ['funded', 'released', 'refunded', 'disputed', 'resolved'] },
            contractId: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            releasedAt: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            senderAddress: { type: 'string' },
            content: { type: 'string', description: 'Message content (encrypted)' },
            contractTxHash: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            read: { type: 'boolean' }
          }
        },
        Rating: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            raterAddress: { type: 'string' },
            ratedAddress: { type: 'string' },
            stars: { type: 'integer', minimum: 1, maximum: 5 },
            review: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        GasEstimate: {
          type: 'object',
          properties: {
            slow: { type: 'object', properties: { fee: { type: 'string' }, usd: { type: 'string', nullable: true } } },
            medium: { type: 'object', properties: { fee: { type: 'string' }, usd: { type: 'string', nullable: true } } },
            fast: { type: 'object', properties: { fee: { type: 'string' }, usd: { type: 'string', nullable: true } } },
            recommended: { type: 'string', enum: ['slow', 'medium', 'fast'] },
            lastUpdated: { type: 'string', format: 'date-time' }
          }
        },
        DAOProposal: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['funding', 'parameter_change', 'arbitrator_election'] },
            proposer: { type: 'string' },
            status: { type: 'string', enum: ['active', 'passed', 'rejected', 'executed', 'expired'] },
            votesFor: { type: 'number' },
            votesAgainst: { type: 'number' },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time' }
          }
        },
        TokenInfo: {
          type: 'object',
          properties: {
            contractId: { type: 'string' },
            symbol: { type: 'string' },
            name: { type: 'string' },
            decimals: { type: 'integer' },
            icon: { type: 'string', nullable: true }
          }
        },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            freelancerAddress: { type: 'string' },
            totalHours: { type: 'number' },
            hourlyRateXlm: { type: 'number' },
            totalXlm: { type: 'number' },
            status: { type: 'string', enum: ['pending', 'paid', 'cancelled'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  },
  apis: [
    path.join(__dirname, '../src/routes/*.js')
  ]
};

function generate() {
  const spec = swaggerJsdoc(swaggerOptions);
  const docsDir = path.join(__dirname, '../../docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const jsonOut = path.join(docsDir, 'openapi.json');
  const yamlOut = path.join(docsDir, 'openapi.yaml');
  fs.writeFileSync(jsonOut, JSON.stringify(spec, null, 2));
  try {
    const yaml = require('js-yaml');
    fs.writeFileSync(yamlOut, yaml.dump(spec));
  } catch (err) {
    console.warn('js-yaml not installed; skipping openapi.yaml');
  }
  console.log('Generated OpenAPI spec to', docsDir);
}

if (require.main === module) {
  generate();
}

module.exports = { swaggerOptions, generate };
