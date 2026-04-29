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
      description: 'Backend API for Stellar MarketPay - A decentralized freelance marketplace built on Stellar blockchain',
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
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'jwt'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
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
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Job ID'
            },
            title: {
              type: 'string',
              description: 'Job title'
            },
            description: {
              type: 'string',
              description: 'Job description'
            },
            budget: {
              type: 'number',
              description: 'Job budget in XLM'
            },
            clientId: {
              type: 'string',
              description: 'Client Stellar address'
            },
            status: {
              type: 'string',
              enum: ['open', 'in_progress', 'completed', 'cancelled'],
              description: 'Job status'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            expiresAt: {
              type: 'string',
              format: 'date-time',
              description: 'Expiration timestamp'
            }
          }
        },
        Application: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Application ID'
            },
            jobId: {
              type: 'string',
              format: 'uuid',
              description: 'Job ID'
            },
            freelancerId: {
              type: 'string',
              description: 'Freelancer Stellar address'
            },
            proposal: {
              type: 'string',
              description: 'Application proposal'
            },
            bidAmount: {
              type: 'number',
              description: 'Bid amount in XLM'
            },
            status: {
              type: 'string',
              enum: ['pending', 'accepted', 'rejected'],
              description: 'Application status'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            }
          }
        }
      }
    }
  },
  apis: [
    './src/routes/*.js',
    './src/server.js'
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;
