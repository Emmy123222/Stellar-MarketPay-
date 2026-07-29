/**
 * src/config/swagger.js
 * Swagger/OpenAPI configuration for Stellar MarketPay API
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Stellar MarketPay API',
      version: '1.0.0',
      description: `Backend API for Stellar MarketPay - A decentralized freelance marketplace built on the Stellar blockchain.

## Authentication
Most endpoints require JWT authentication obtained via the **/api/auth** challenge-response flow using Stellar wallet signatures.

## Pagination
List endpoints support cursor-based pagination via the \`after\` query parameter. Responses include \`next_cursor\` and \`has_more\` fields.`,
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
      { name: 'WebAuthn', description: 'Passkey/WebAuthn authentication' },
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
      { name: 'Utility', description: 'Utility endpoints (rate limit, CSRF)' }
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
                code: {
                  type: 'string',
                  description: 'Machine-readable error code',
                  example: 'JOB_NOT_FOUND'
                },
                message: {
                  type: 'string',
                  description: 'Human-readable error message',
                  example: 'Job not found'
                },
                details: {
                  description: 'Optional additional context (e.g. validation errors)',
                  nullable: true
                }
              }
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Success status'
            },
            message: {
              type: 'string',
              description: 'Success message'
            }
          }
        },
        StellarAccount: {
          type: 'object',
          properties: {
            publicKey: {
              type: 'string',
              description: 'Stellar public key',
              example: 'GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O'
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
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'completed', 'cancelled', 'expired', 'disputed'],
              description: 'Job status'
            },
            category: { type: 'string', description: 'Job category' },
            skills: { type: 'array', items: { type: 'string' }, description: 'Required skills' },
            currency: { type: 'string', description: 'Payment currency (XLM, USDC, etc.)', default: 'XLM' },
            visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
            createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
            expiresAt: { type: 'string', format: 'date-time', description: 'Expiration timestamp' },
            boostedUntil: { type: 'string', format: 'date-time', description: 'Boost expiration', nullable: true }
          }
        },
        Application: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Application ID' },
            jobId: { type: 'string', format: 'uuid', description: 'Job ID' },
            freelancerAddress: { type: 'string', description: 'Freelancer Stellar address' },
            proposal: { type: 'string', description: 'Application proposal' },
            bidAmount: { type: 'number', description: 'Bid amount in XLM' },
            estimatedDuration: { type: 'string', description: 'Estimated completion time' },
            status: {
              type: 'string',
              enum: ['pending', 'accepted', 'rejected', 'withdrawn'],
              description: 'Application status'
            },
            createdAt: { type: 'string', format: 'date-time', description: 'Creation timestamp' }
          }
        },
        Profile: {
          type: 'object',
          properties: {
            publicKey: { type: 'string', description: 'Stellar public key' },
            displayName: { type: 'string', description: 'Display name' },
            bio: { type: 'string', description: 'User biography' },
            role: { type: 'string', enum: ['freelancer', 'client', 'both'], description: 'User role' },
            skills: { type: 'array', items: { type: 'string' }, description: 'User skills' },
            rating: { type: 'number', description: 'Average rating (1-5)' },
            totalEarnedXlm: { type: 'number', description: 'Total XLM earned' },
            completedJobs: { type: 'integer', description: 'Number of completed jobs' },
            availability: { type: 'string', enum: ['available', 'busy', 'unavailable'], description: 'Availability status' },
            email: { type: 'string', format: 'email', description: 'Email address' },
            encryptionPublicKey: { type: 'string', description: 'NaCl X25519 public key for E2E encryption', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Escrow: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Escrow ID' },
            jobId: { type: 'string', format: 'uuid', description: 'Associated job ID' },
            amountXlm: { type: 'number', description: 'Escrow amount in XLM' },
            status: {
              type: 'string',
              enum: ['funded', 'released', 'refunded', 'disputed', 'resolved'],
              description: 'Escrow status'
            },
            contractId: { type: 'string', description: 'Soroban contract ID' },
            createdAt: { type: 'string', format: 'date-time' },
            releasedAt: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Message ID' },
            jobId: { type: 'string', format: 'uuid', description: 'Associated job ID' },
            senderAddress: { type: 'string', description: 'Sender Stellar address' },
            content: { type: 'string', description: 'Message content (encrypted)' },
            contractTxHash: { type: 'string', description: 'On-chain transaction hash', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            read: { type: 'boolean', description: 'Whether the message has been read' }
          }
        },
        Rating: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Rating ID' },
            jobId: { type: 'string', format: 'uuid', description: 'Associated job ID' },
            raterAddress: { type: 'string', description: 'Rater Stellar address' },
            ratedAddress: { type: 'string', description: 'Rated user Stellar address' },
            stars: { type: 'integer', minimum: 1, maximum: 5, description: 'Rating (1-5)' },
            review: { type: 'string', description: 'Text review (max 200 chars)' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Notification: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Notification ID' },
            type: { type: 'string', description: 'Notification type' },
            title: { type: 'string', description: 'Notification title' },
            body: { type: 'string', description: 'Notification body' },
            read: { type: 'boolean', description: 'Read status' },
            data: { type: 'object', description: 'Additional payload data' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        DisputeEvidence: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            uploaderAddress: { type: 'string' },
            fileName: { type: 'string' },
            fileSize: { type: 'integer' },
            mimeType: { type: 'string' },
            ipfsCid: { type: 'string', description: 'IPFS content identifier' },
            gatewayUrl: { type: 'string', description: 'IPFS gateway URL' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        TimeEntry: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
            freelancerAddress: { type: 'string' },
            durationMinutes: { type: 'integer' },
            description: { type: 'string' },
            startedAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' }
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
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        DAOProposal: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['funding', 'parameter_change', 'arbitrator_election'] },
            proposer: { type: 'string', description: 'Proposer Stellar address' },
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
            contractId: { type: 'string', description: 'Stellar asset contract ID' },
            symbol: { type: 'string', description: 'Token symbol' },
            name: { type: 'string', description: 'Token name' },
            decimals: { type: 'integer' },
            icon: { type: 'string', description: 'Token icon URL', nullable: true }
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
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'array', items: {} },
            next_cursor: { type: 'string', nullable: true, description: 'Cursor for next page' },
            has_more: { type: 'boolean', description: 'Whether more results exist' }
          }
        }
      }
    }
  },
  apis: [
    './src/routes/*.js',
    '!./src/routes/*.test.js',
    './src/server.js'
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;
