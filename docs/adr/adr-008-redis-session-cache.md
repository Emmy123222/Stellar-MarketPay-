# ADR-008: Redis for Session and Cache Management

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, DevOps Team

## Context

Stellar MarketPay requires temporary storage for various stateful operations:

- **Authentication challenges**: SEP-10 challenges must be stored for verification (5-minute TTL)
- **WebAuthn challenges**: WebAuthn registration/auth challenges (5-minute TTL)
- **Rate limiting**: Track API request counts per IP/user
- **Session data**: User preferences, temporary state
- **API response caching**: Horizon API responses, job listings
- **WebSocket state**: Active connections, presence tracking
- **Job recommendations**: Cached personalized job matches

These requirements share common characteristics:

- **Short-lived**: Data expires after minutes to hours
- **High throughput**: Thousands of reads/writes per second
- **Low latency**: < 10ms response time required
- **Atomic operations**: Counters, sets, sorted sets
- **Pub/sub**: Real-time notifications

PostgreSQL is not optimized for this workload (slow, adds disk I/O, requires cleanup).

## Decision

We will use **Redis** (in-memory data store) for all ephemeral state and caching, with the following architecture:

### Use Cases

| Use Case | Data Structure | TTL | Example |
|----------|---------------|-----|---------|
| SEP-10 Challenges | String | 5 min | `sep10:GXXXX` → `challenge_xdr` |
| WebAuthn Challenges | String | 5 min | `webauthn:GXXXX` → `challenge` |
| Rate Limiting | Counter | 1 hour | `ratelimit:ip:1.2.3.4` → `45` |
| API Cache | String | 30 sec | `api:jobs:category:dev` → `json` |
| Active Sessions | Set | 1 hour | `sessions:GXXXX` → `{token1, token2}` |
| WebSocket Presence | Set | 5 min | `ws:job:123` → `{user1, user2}` |
| Job Recommendations | Sorted Set | 24 hours | `recs:GXXXX` → `{job1:0.95, job2:0.87}` |

### Architecture

```
Backend API
   ↓
Redis (localhost:6379 in dev, cluster in prod)
   ↓
Data expires automatically (TTL)
```

### Implementation

#### Connection

```javascript
// src/config/redis.js
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

module.exports = redis;
```

#### SEP-10 Challenge Storage

```javascript
// Store challenge
await redis.setex(
  `sep10:${accountId}`,
  300, // 5 minutes
  challengeXdr
);

// Retrieve and delete
const challengeXdr = await redis.getdel(`sep10:${accountId}`);
if (!challengeXdr) {
  return res.status(400).json({ error: 'Challenge expired or not found' });
}
```

#### Rate Limiting

```javascript
// src/middleware/rateLimit.js
const redis = require('../config/redis');

async function rateLimit(req, res, next) {
  const key = `ratelimit:${req.ip}`;
  const limit = 100; // requests per window
  const window = 3600; // 1 hour
  
  const current = await redis.incr(key);
  
  if (current === 1) {
    await redis.expire(key, window);
  }
  
  if (current > limit) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: await redis.ttl(key),
    });
  }
  
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
  
  next();
}

module.exports = rateLimit;
```

#### API Response Caching

```javascript
// Cache job listings
async function getJobs(category) {
  const cacheKey = `api:jobs:category:${category}`;
  
  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Cache miss, query database
  const jobs = await db.query(
    'SELECT * FROM jobs WHERE category = $1 AND status = $2',
    [category, 'open']
  );
  
  // Store in cache for 30 seconds
  await redis.setex(cacheKey, 30, JSON.stringify(jobs.rows));
  
  return jobs.rows;
}
```

#### WebSocket Presence

```javascript
// Add user to room
await redis.sadd(`ws:job:${jobId}`, userAddress);
await redis.expire(`ws:job:${jobId}`, 300); // 5 minutes

// Get active users in room
const activeUsers = await redis.smembers(`ws:job:${jobId}`);

// Remove user from room
await redis.srem(`ws:job:${jobId}`, userAddress);
```

## Rationale

### Why Redis?

- **In-Memory**: Microsecond latency (< 1ms avg)
- **Built-in TTL**: Automatic expiration, no manual cleanup
- **Rich Data Types**: Strings, hashes, lists, sets, sorted sets
- **Atomic Operations**: INCR, SADD, etc. are atomic (no race conditions)
- **Pub/Sub**: Built-in message broker for real-time
- **Persistence Options**: Can persist to disk for durability
- **Battle-Tested**: Used by Twitter, GitHub, Stack Overflow
- **Simple**: Easy to deploy and operate
- **Clustering**: Horizontal scaling support

### Why Not Alternatives?

#### PostgreSQL for Ephemeral Data

- **Pros**: Already in stack, ACID guarantees
- **Cons**: Slow for high-frequency operations, requires disk I/O, no built-in TTL, manual cleanup

#### Memcached

- **Pros**: Simpler than Redis, slightly faster for pure caching
- **Cons**: No data structures (only strings), no persistence, no pub/sub, no atomic operations

#### In-Memory JavaScript Objects

- **Pros**: Zero setup, extremely fast
- **Cons**: Not shared across processes, no persistence, no TTL, memory leaks, lost on restart

#### etcd / Consul

- **Pros**: Strong consistency, distributed
- **Cons**: Overkill for caching, slower than Redis, designed for config management

#### DynamoDB

- **Pros**: Serverless, managed
- **Cons**: Higher latency (single-digit ms), more expensive, AWS-only

## Consequences

### Positive

- ✅ **Low Latency**: Sub-millisecond response times
- ✅ **High Throughput**: 100k+ ops/sec on single instance
- ✅ **Automatic Expiration**: No manual cleanup required
- ✅ **Atomic Operations**: Race condition-free counters
- ✅ **Pub/Sub Support**: Built-in message broker
- ✅ **Simple Deployment**: Single binary, easy to run
- ✅ **Cost-Effective**: Open source, low resource usage
- ✅ **Battle-Tested**: Mature and widely used

### Negative

- ❌ **Additional Infrastructure**: Another service to deploy/monitor
- ❌ **Memory Limits**: Data must fit in RAM
- ❌ **Data Loss Risk**: In-memory data lost on crash (acceptable for cache)
- ❌ **Single Point of Failure**: Requires clustering for HA
- ❌ **No Complex Queries**: Not a replacement for PostgreSQL

## Implementation Details

### Environment Variables

```env
# .env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

### Docker Setup (Development)

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

volumes:
  redis-data:
```

### Key Naming Convention

```
<namespace>:<resource>:<identifier>
```

Examples:
- `sep10:GXXXXXX` - SEP-10 challenge for account
- `ratelimit:ip:1.2.3.4` - Rate limit for IP
- `api:jobs:category:dev` - Cached jobs for category
- `ws:job:123` - WebSocket presence for job
- `session:token:abc123` - Session data for token

### Monitoring

```javascript
// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;
    
    res.json({
      status: 'healthy',
      redis: {
        status: 'ok',
        latency_ms: latency,
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      redis: {
        status: 'down',
        error: error.message,
      },
    });
  }
});

// Monitor memory usage
async function logRedisStats() {
  const info = await redis.info('memory');
  console.log('Redis memory usage:', info);
}

setInterval(logRedisStats, 60000); // Every minute
```

### Error Handling

```javascript
// Graceful degradation if Redis is unavailable
async function getCached(key, fallback) {
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.warn('Redis error, using fallback:', error);
  }
  
  return await fallback();
}

// Example usage
const jobs = await getCached('api:jobs:open', async () => {
  return await db.query('SELECT * FROM jobs WHERE status = $1', ['open']);
});
```

### Cache Invalidation

```javascript
// Invalidate cache on data change
async function createJob(jobData) {
  const job = await db.query(
    'INSERT INTO jobs (...) VALUES (...) RETURNING *',
    [jobData]
  );
  
  // Invalidate related caches
  await redis.del(`api:jobs:category:${job.category}`);
  await redis.del('api:jobs:all');
  await redis.del(`api:jobs:client:${job.client_address}`);
  
  return job;
}
```

### Production Deployment

**AWS ElastiCache**:
```bash
# Create Redis cluster
aws elasticache create-replication-group \
  --replication-group-id stellar-marketpay-redis \
  --replication-group-description "Stellar MarketPay Cache" \
  --engine redis \
  --cache-node-type cache.t3.micro \
  --num-cache-clusters 2 \
  --automatic-failover-enabled
```

**GCP Memorystore**:
```bash
# Create Redis instance
gcloud redis instances create stellar-marketpay-redis \
  --size=1 \
  --region=us-central1 \
  --tier=standard-ha
```

**DigitalOcean Managed Redis**:
```bash
# Create via dashboard or API
doctl databases create stellar-marketpay-redis \
  --engine redis \
  --size db-s-1vcpu-1gb
```

### Backup Strategy

For persistent data (if RDB enabled):

```bash
# Manual backup
redis-cli BGSAVE

# Automated backups (cron)
0 * * * * redis-cli BGSAVE && cp /var/lib/redis/dump.rdb /backups/redis-$(date +\%Y\%m\%d-\%H\%M).rdb
```

For most use cases (ephemeral cache), backups are not needed.

### Security

```javascript
// Enable password protection
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD, // Set strong password in prod
});

// Limit network access
// - Bind to 127.0.0.1 in development
// - Use VPC/private network in production
// - Enable TLS for encrypted connections
```

## Future Considerations

### Redis Cluster

For high availability and scalability:

```javascript
const Redis = require('ioredis');

const cluster = new Redis.Cluster([
  { host: 'redis-1', port: 6379 },
  { host: 'redis-2', port: 6379 },
  { host: 'redis-3', port: 6379 },
]);
```

### Redis Streams

For event sourcing and message queues:

```javascript
// Add job processing event
await redis.xadd(
  'job-events',
  '*',
  'type', 'created',
  'jobId', jobId,
  'timestamp', Date.now()
);

// Consume events
const events = await redis.xread('STREAMS', 'job-events', '0');
```

### Geo-Distributed Cache

For multi-region deployments, use Redis with active-active replication or route to nearest region.

### Cache Warming

Pre-populate cache on startup:

```javascript
// Warm cache on startup
async function warmCache() {
  const popularJobs = await db.query(
    'SELECT * FROM jobs WHERE view_count > 100 ORDER BY created_at DESC LIMIT 50'
  );
  
  for (const job of popularJobs.rows) {
    await redis.setex(
      `api:job:${job.id}`,
      3600,
      JSON.stringify(job)
    );
  }
  
  console.log('✅ Cache warmed with popular jobs');
}

warmCache();
```

## Related ADRs

- ADR-004: SEP-10 Authentication (uses Redis for challenges)
- ADR-007: WebAuthn Secondary Auth (uses Redis for challenges)
- ADR-009: WebSocket vs SSE for Real-Time (uses Redis for pub/sub)

## References

- [Redis Documentation](https://redis.io/docs/)
- [ioredis Client](https://github.com/redis/ioredis)
- [Redis Best Practices](https://redis.io/docs/management/optimization/)
- [Redis Security](https://redis.io/docs/management/security/)
- [Redis Persistence](https://redis.io/docs/management/persistence/)
- [Caching Strategies](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/Strategies.html)
