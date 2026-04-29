# API Documentation

This document describes the API documentation setup for the Stellar MarketPay backend.

## Overview

The Stellar MarketPay API uses OpenAPI 3.0 specification with Swagger UI for interactive documentation. All API endpoints are documented with JSDoc annotations that are automatically processed to generate the OpenAPI specification.

## Features

- **Interactive Swagger UI**: Available at `/api/docs` in development and production
- **Auto-generated OpenAPI spec**: Generated from JSDoc annotations in route files
- **Build-time validation**: CI/CD checks ensure all routes are documented
- **Live documentation**: Always in sync with the actual API implementation

## Accessing Documentation

### Development
- **Swagger UI**: http://localhost:4000/api/docs
- **OpenAPI JSON**: http://localhost:4000/api/docs/json

### Production
- **Swagger UI**: https://api.stellarmarketpay.com/api/docs
- **OpenAPI JSON**: https://api.stellarmarketpay.com/api/docs/json

## Adding Documentation

When adding new API endpoints, follow these steps:

### 1. Add JSDoc Annotations

```javascript
/**
 * @swagger
 * /api/your-endpoint:
 *   get:
 *     summary: Brief description of the endpoint
 *     description: Detailed description of what the endpoint does
 *     tags: [YourTag]
 *     parameters:
 *       - in: query
 *         name: paramName
 *         required: true
 *         schema:
 *           type: string
 *         description: Parameter description
 *     responses:
 *       200:
 *         description: Success response description
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/YourSchema'
 */
router.get("/your-endpoint", (req, res) => {
  // Your implementation
});
```

### 2. Define Schemas (if needed)

Add new schemas to the `components/schemas` section in `src/config/swagger.js`:

```javascript
YourSchema: {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Resource ID'
    },
    name: {
      type: 'string',
      description: 'Resource name'
    }
  }
}
```

### 3. Generate Documentation

Run the build command to generate the OpenAPI specification:

```bash
npm run build
```

Or generate just the documentation:

```bash
npm run generate-openapi
```

## Documentation Standards

### Required Fields
- `summary`: Brief, one-line description
- `description`: Detailed explanation of the endpoint
- `tags`: Group endpoints logically (e.g., [Authentication], [Jobs], [Applications])
- `responses`: Document at least the success response and common error responses

### Response Documentation
Always document:
- `200`: Success response
- `400`: Bad request
- `401`: Unauthorized (if authentication required)
- `404`: Resource not found
- `500`: Server error

### Parameter Documentation
- Path parameters: Mark as `required: true`
- Query parameters: Include type, format, and description
- Request body: Include schema validation

## API Tags

The following tags are used for organizing endpoints:

- **Authentication**: Auth-related endpoints (`/api/auth`)
- **Health**: Health check and status endpoints (`/health`)
- **Jobs**: Job management endpoints (`/api/jobs`)
- **Applications**: Application management (`/api/applications`)
- **Profiles**: User profile management (`/api/profiles`)
- **Escrow**: Escrow and payment management (`/api/escrow`)
- **Ratings**: Rating and review system (`/api/ratings`)
- **Messages**: Messaging system (`/api/messages`)

## Security Documentation

### Authentication Methods
- **Bearer Token**: JWT token in Authorization header
- **Cookie Auth**: JWT token in HTTP cookie

Add security requirements to protected endpoints:

```javascript
security:
  - bearerAuth: []
  - cookieAuth: []
```

## CI/CD Integration

The GitHub Actions workflow `.github/workflows/check-openapi-docs.yml`:

1. **Validates** that all routes have OpenAPI annotations
2. **Generates** the OpenAPI specification
3. **Validates** JSON syntax
4. **Posts** documentation status to pull requests
5. **Uploads** the specification as an artifact

### Build Process

The build process includes:
1. OpenAPI specification generation
2. Linting and validation
3. Documentation completeness checks

## Troubleshooting

### Common Issues

1. **Missing @swagger annotations**
   - Error: "Found X undocumented routes"
   - Solution: Add JSDoc annotations to undocumented routes

2. **Invalid JSON in openapi.json**
   - Error: "Invalid JSON"
   - Solution: Check for syntax errors in JSDoc annotations

3. **Missing schemas**
   - Error: Schema not found
   - Solution: Define missing schemas in swagger configuration

### Debugging

Enable debug logging by setting environment variable:
```bash
DEBUG=swagger-jsdoc* npm run generate-openapi
```

## Generated Files

- `docs/openapi.json`: Complete OpenAPI 3.0 specification
- `/api/docs`: Interactive Swagger UI endpoint
- `/api/docs/json`: Raw OpenAPI JSON endpoint

## Maintenance

### Regular Tasks
1. Review documentation for accuracy after API changes
2. Update schemas when data models change
3. Add new tags when introducing new endpoint categories
4. Validate documentation completeness before releases

### Version Updates
- Update API version in `src/config/swagger.js`
- Maintain backward compatibility when possible
- Document breaking changes in release notes

## Examples

### Complete Endpoint Documentation

```javascript
/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     summary: Get a specific job
 *     description: Retrieves detailed information about a specific job posting
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *       - in: query
 *         name: viewerAddress
 *         schema:
 *           type: string
 *         description: Viewer's Stellar address for permission checks
 *     responses:
 *       200:
 *         description: Job retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Access denied - private job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/:id", (req, res) => {
  // Implementation
});
```

This comprehensive documentation system ensures that the Stellar MarketPay API remains well-documented, easy to understand, and always in sync with the implementation.
