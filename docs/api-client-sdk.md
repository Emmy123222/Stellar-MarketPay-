# API Client SDK

Stellar MarketPay provides auto-generated client SDKs for TypeScript, Python, and Go to simplify API integration.

## Available SDKs

| Language | Package | Documentation |
|----------|---------|---------------|
| TypeScript | `@stellar-marketpay/api-client` | [TypeScript Docs](#typescript-sdk) |
| Python | `stellar-marketpay` | [Python Docs](#python-sdk) |
| Go | `github.com/stellar-marketpay/go-client` | [Go Docs](#go-sdk) |

## Quick Start

### TypeScript/JavaScript

```bash
npm install @stellar-marketpay/api-client
```

```typescript
import { StellarMarketPayClient } from '@stellar-marketpay/api-client';

const client = new StellarMarketPayClient({
  baseURL: 'https://api.stellarmarketpay.com',
  token: 'your_jwt_token', // Optional, for authenticated endpoints
});

// List jobs
const jobs = await client.jobs.list({
  category: 'development',
  limit: 20,
});

console.log(jobs.data);

// Create a job
const newJob = await client.jobs.create({
  title: 'Build a website',
  description: 'Need a responsive Next.js website',
  budget: 500,
  clientId: 'GXXXXXX...',
  category: 'development',
  skills: ['React', 'Next.js', 'TailwindCSS'],
});

console.log('Job created:', newJob.data.id);
```

### Python

```bash
pip install stellar-marketpay
```

```python
from stellar_marketpay import StellarMarketPayClient

client = StellarMarketPayClient(
    base_url="https://api.stellarmarketpay.com",
    token="your_jwt_token"  # Optional
)

# List jobs
jobs = client.jobs.list(category="development", limit=20)
print(jobs.data)

# Create a job
new_job = client.jobs.create(
    title="Build a website",
    description="Need a responsive Next.js website",
    budget=500,
    client_id="GXXXXXX...",
    category="development",
    skills=["React", "Next.js", "TailwindCSS"]
)
print(f"Job created: {new_job.data.id}")
```

### Go

```bash
go get github.com/stellar-marketpay/go-client
```

```go
package main

import (
    "context"
    "fmt"
    "github.com/stellar-marketpay/go-client"
)

func main() {
    client := marketpay.NewClient(
        marketpay.WithBaseURL("https://api.stellarmarketpay.com"),
        marketpay.WithToken("your_jwt_token"), // Optional
    )
    
    ctx := context.Background()
    
    // List jobs
    jobs, err := client.Jobs.List(ctx, &marketpay.JobListParams{
        Category: marketpay.String("development"),
        Limit:    marketpay.Int(20),
    })
    if err != nil {
        panic(err)
    }
    fmt.Printf("Found %d jobs\n", len(jobs.Data))
    
    // Create a job
    newJob, err := client.Jobs.Create(ctx, &marketpay.JobCreateParams{
        Title:       "Build a website",
        Description: "Need a responsive Next.js website",
        Budget:      500.0,
        ClientID:    "GXXXXXX...",
        Category:    "development",
        Skills:      []string{"React", "Next.js", "TailwindCSS"},
    })
    if err != nil {
        panic(err)
    }
    fmt.Printf("Job created: %s\n", newJob.Data.ID)
}
```

## TypeScript SDK

### Installation

```bash
npm install @stellar-marketpay/api-client
# or
yarn add @stellar-marketpay/api-client
# or
pnpm add @stellar-marketpay/api-client
```

### Configuration

```typescript
import { StellarMarketPayClient } from '@stellar-marketpay/api-client';

const client = new StellarMarketPayClient({
  baseURL: 'https://api.stellarmarketpay.com',
  token: 'your_jwt_token', // Optional
  timeout: 10000, // 10 seconds (default: 30000)
  headers: {
    'X-Custom-Header': 'value',
  },
});
```

### Authentication

```typescript
// Get challenge transaction
const { transaction } = await client.auth.getChallenge({
  account: 'GXXXXXX...',
});

// Sign with Freighter wallet (in browser)
const signedXdr = await window.freighter.signTransaction(transaction);

// Verify and get JWT
const { token } = await client.auth.authenticate({
  transaction: signedXdr,
});

// Update client with token
client.setToken(token);
```

### Jobs

```typescript
// List jobs with filters
const jobs = await client.jobs.list({
  category: 'development',
  status: 'open',
  limit: 20,
  cursor: 'eyJjcmVhdGVkX2F0IjoxNjg...',
});

// Get a specific job
const job = await client.jobs.get('job-id-123');

// Create a job
const newJob = await client.jobs.create({
  title: 'Build a DeFi dashboard',
  description: 'Need a React dashboard for Stellar DeFi analytics',
  budget: 1000,
  clientId: 'GXXXXXX...',
  category: 'development',
  skills: ['React', 'TypeScript', 'Stellar SDK'],
  visibility: 'public',
});

// Update a job
const updatedJob = await client.jobs.update('job-id-123', {
  status: 'in_progress',
});

// Delete a job
await client.jobs.delete('job-id-123');
```

### Applications

```typescript
// Get applications for a job
const applications = await client.applications.listByJob('job-id-123');

// Submit an application
const application = await client.applications.create({
  jobId: 'job-id-123',
  freelancerId: 'GXXXXXX...',
  proposal: 'I have 5 years of experience with React and Stellar...',
  bidAmount: 800,
  estimatedDuration: '2 weeks',
});

// Accept an application
await client.applications.accept('application-id-123');

// Reject an application
await client.applications.reject('application-id-123');
```

### Error Handling

```typescript
import { StellarMarketPayError } from '@stellar-marketpay/api-client';

try {
  const job = await client.jobs.get('invalid-id');
} catch (error) {
  if (error instanceof StellarMarketPayError) {
    console.error('API Error:', error.message);
    console.error('Status Code:', error.statusCode);
    console.error('Response:', error.response);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### TypeScript Types

All SDK methods are fully typed:

```typescript
import type {
  Job,
  Application,
  JobCreateParams,
  JobListParams,
  PaginatedResponse,
} from '@stellar-marketpay/api-client';

const jobs: PaginatedResponse<Job> = await client.jobs.list({
  limit: 20,
});

jobs.data.forEach((job: Job) => {
  console.log(job.title, job.budget);
});
```

## Python SDK

### Installation

```bash
pip install stellar-marketpay
# or
poetry add stellar-marketpay
```

### Configuration

```python
from stellar_marketpay import StellarMarketPayClient

client = StellarMarketPayClient(
    base_url="https://api.stellarmarketpay.com",
    token="your_jwt_token",  # Optional
    timeout=10.0,  # seconds
)
```

### Authentication

```python
# Get challenge transaction
challenge = client.auth.get_challenge(account="GXXXXXX...")

# Sign with Stellar SDK
from stellar_sdk import Keypair, TransactionEnvelope
keypair = Keypair.from_secret("SXXXXXX...")
envelope = TransactionEnvelope.from_xdr(challenge["transaction"], network_passphrase)
envelope.sign(keypair)

# Verify and get JWT
auth_result = client.auth.authenticate(transaction=envelope.to_xdr())
client.set_token(auth_result["token"])
```

### Jobs

```python
# List jobs
jobs = client.jobs.list(
    category="development",
    status="open",
    limit=20,
)

for job in jobs.data:
    print(f"{job['title']} - {job['budget']} XLM")

# Get a specific job
job = client.jobs.get("job-id-123")

# Create a job
new_job = client.jobs.create(
    title="Build a DeFi dashboard",
    description="Need a React dashboard for Stellar DeFi analytics",
    budget=1000,
    client_id="GXXXXXX...",
    category="development",
    skills=["React", "TypeScript", "Stellar SDK"],
)

# Update a job
updated_job = client.jobs.update("job-id-123", status="in_progress")

# Delete a job
client.jobs.delete("job-id-123")
```

### Applications

```python
# Get applications for a job
applications = client.applications.list_by_job("job-id-123")

# Submit an application
application = client.applications.create(
    job_id="job-id-123",
    freelancer_id="GXXXXXX...",
    proposal="I have 5 years of experience...",
    bid_amount=800,
    estimated_duration="2 weeks",
)

# Accept an application
client.applications.accept("application-id-123")

# Reject an application
client.applications.reject("application-id-123")
```

### Error Handling

```python
from stellar_marketpay import StellarMarketPayError

try:
    job = client.jobs.get("invalid-id")
except StellarMarketPayError as e:
    print(f"API Error: {e.message}")
    print(f"Status Code: {e.status_code}")
    print(f"Response: {e.response}")
```

### Type Hints

The Python SDK includes type hints:

```python
from stellar_marketpay import StellarMarketPayClient
from stellar_marketpay.types import Job, Application, JobListParams

client: StellarMarketPayClient = StellarMarketPayClient(...)

jobs: list[Job] = client.jobs.list(JobListParams(limit=20))

for job in jobs:
    print(job.title, job.budget)
```

## Go SDK

### Installation

```bash
go get github.com/stellar-marketpay/go-client
```

### Configuration

```go
import (
    marketpay "github.com/stellar-marketpay/go-client"
)

client := marketpay.NewClient(
    marketpay.WithBaseURL("https://api.stellarmarketpay.com"),
    marketpay.WithToken("your_jwt_token"), // Optional
    marketpay.WithTimeout(10 * time.Second),
)
```

### Authentication

```go
import (
    "context"
    marketpay "github.com/stellar-marketpay/go-client"
)

ctx := context.Background()

// Get challenge transaction
challenge, err := client.Auth.GetChallenge(ctx, &marketpay.ChallengeParams{
    Account: "GXXXXXX...",
})
if err != nil {
    panic(err)
}

// Sign with Stellar SDK
// (implementation depends on your Stellar Go SDK)

// Verify and get JWT
auth, err := client.Auth.Authenticate(ctx, &marketpay.AuthenticateParams{
    Transaction: signedXdr,
})
if err != nil {
    panic(err)
}

// Update client with token
client.SetToken(auth.Token)
```

### Jobs

```go
ctx := context.Background()

// List jobs
jobs, err := client.Jobs.List(ctx, &marketpay.JobListParams{
    Category: marketpay.String("development"),
    Status:   marketpay.String("open"),
    Limit:    marketpay.Int(20),
})
if err != nil {
    panic(err)
}

for _, job := range jobs.Data {
    fmt.Printf("%s - %.2f XLM\n", job.Title, job.Budget)
}

// Get a specific job
job, err := client.Jobs.Get(ctx, "job-id-123")
if err != nil {
    panic(err)
}

// Create a job
newJob, err := client.Jobs.Create(ctx, &marketpay.JobCreateParams{
    Title:       "Build a DeFi dashboard",
    Description: "Need a React dashboard for Stellar DeFi analytics",
    Budget:      1000.0,
    ClientID:    "GXXXXXX...",
    Category:    "development",
    Skills:      []string{"React", "TypeScript", "Stellar SDK"},
})
if err != nil {
    panic(err)
}

// Update a job
updatedJob, err := client.Jobs.Update(ctx, "job-id-123", &marketpay.JobUpdateParams{
    Status: marketpay.String("in_progress"),
})
if err != nil {
    panic(err)
}

// Delete a job
err = client.Jobs.Delete(ctx, "job-id-123")
if err != nil {
    panic(err)
}
```

### Applications

```go
// Get applications for a job
applications, err := client.Applications.ListByJob(ctx, "job-id-123")
if err != nil {
    panic(err)
}

// Submit an application
application, err := client.Applications.Create(ctx, &marketpay.ApplicationCreateParams{
    JobID:             "job-id-123",
    FreelancerID:      "GXXXXXX...",
    Proposal:          "I have 5 years of experience...",
    BidAmount:         800.0,
    EstimatedDuration: "2 weeks",
})
if err != nil {
    panic(err)
}

// Accept an application
err = client.Applications.Accept(ctx, "application-id-123")
if err != nil {
    panic(err)
}

// Reject an application
err = client.Applications.Reject(ctx, "application-id-123")
if err != nil {
    panic(err)
}
```

### Error Handling

```go
import (
    marketpay "github.com/stellar-marketpay/go-client"
)

job, err := client.Jobs.Get(ctx, "invalid-id")
if err != nil {
    if apiErr, ok := err.(*marketpay.Error); ok {
        fmt.Printf("API Error: %s\n", apiErr.Message)
        fmt.Printf("Status Code: %d\n", apiErr.StatusCode)
        fmt.Printf("Response: %v\n", apiErr.Response)
    } else {
        fmt.Printf("Unexpected error: %v\n", err)
    }
}
```

## SDK Generation

The SDKs are auto-generated from the OpenAPI specification (`backend/docs/openapi.json`).

### Regenerate TypeScript Client

```bash
cd backend
npm run generate-openapi
npx openapi-typescript-codegen --input docs/openapi.json --output ../sdk/typescript/src --client axios
```

### Regenerate Python Client

```bash
cd backend
npm run generate-openapi
openapi-python-client generate --path docs/openapi.json --output-path ../sdk/python
```

### Regenerate Go Client

```bash
cd backend
npm run generate-openapi
oapi-codegen -package marketpay docs/openapi.json > ../sdk/go/client.go
```

### CI/CD Integration

The `.github/workflows/generate-sdk.yml` workflow automatically regenerates clients when the OpenAPI spec changes:

```yaml
name: Generate SDK
on:
  push:
    paths:
      - 'backend/docs/openapi.json'
      - 'backend/src/routes/**'

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - name: Generate OpenAPI
        run: cd backend && npm run generate-openapi
      - name: Generate TypeScript Client
        run: npx openapi-typescript-codegen --input backend/docs/openapi.json --output sdk/typescript/src --client axios
      - name: Generate Python Client
        run: openapi-python-client generate --path backend/docs/openapi.json --output-path sdk/python
      - name: Generate Go Client
        run: oapi-codegen -package marketpay backend/docs/openapi.json > sdk/go/client.go
      - name: Commit changes
        run: |
          git config --global user.name 'GitHub Actions'
          git config --global user.email 'actions@github.com'
          git add sdk/
          git commit -m "chore: regenerate SDK clients" || exit 0
          git push
```

## Publishing

### TypeScript (npm)

```bash
cd sdk/typescript
npm version patch
npm publish --access public
```

### Python (PyPI)

```bash
cd sdk/python
poetry build
poetry publish
```

### Go (GitHub)

```bash
cd sdk/go
git tag v1.0.0
git push origin v1.0.0
```

## Support

For SDK issues, questions, or feature requests:

- **GitHub Issues**: [github.com/stellar-marketpay/issues](https://github.com/stellar-marketpay/issues)
- **API Documentation**: [docs/API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- **OpenAPI Spec**: [backend/docs/openapi.json](../backend/docs/openapi.json)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on improving the SDKs.

---

**Last Updated**: 2026-05-28
