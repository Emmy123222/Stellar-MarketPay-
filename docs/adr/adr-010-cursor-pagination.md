# ADR-010: Cursor-Based Pagination

**Status:** Accepted  
**Date:** 2026-05-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Backend Team, Frontend Team

## Context

Stellar MarketPay displays lists of jobs, applications, messages, and transactions that can contain hundreds or thousands of items. Users need to browse these lists efficiently without loading all data at once.

Requirements:

- **Performance**: Fast queries even with large datasets (100,000+ records)
- **Consistency**: No duplicate or missing items when data changes
- **Scalability**: Support datasets that grow over time
- **UX**: Smooth infinite scroll and pagination
- **API Simplicity**: Easy to implement and use

Traditional pagination methods have limitations:

1. **Offset-based** (`LIMIT/OFFSET`): Simple but slow for deep pages, inconsistent with data changes
2. **Page-based** (`page=3&size=20`): Same issues as offset-based, user-friendly URLs
3. **Cursor-based**: Fast, consistent, but requires indexed column

## Decision

We will implement **cursor-based pagination** using opaque tokens for all list endpoints, with the following architecture:

### Pagination Approach

**Method**: Use the last item's unique identifier (ID or timestamp) as the cursor for the next page.

**Cursor Format**: Opaque base64-encoded JSON token containing sort key and direction.

**Query Pattern**:
```sql
SELECT * FROM jobs
WHERE created_at < $cursor_timestamp
ORDER BY created_at DESC
LIMIT 20
```

### API Design

#### Request

```
GET /api/jobs?limit=20&cursor=eyJjcmVhdGVkX2F0IjoxNjg...
```

Parameters:
- `limit`: Number of items per page (default: 20, max: 100)
- `cursor`: Opaque token for next page (optional, omit for first page)

#### Response

```json
{
  "success": true,
  "data": [
    { "id": "123", "title": "Build a website", "created_at": "2026-05-28T10:00:00Z" },
    { "id": "122", "title": "Design a logo", "created_at": "2026-05-28T09:30:00Z" }
  ],
  "pagination": {
    "nextCursor": "eyJjcmVhdGVkX2F0IjoxNjg1MjY...",
    "hasMore": true,
    "limit": 20
  }
}
```

### Implementation

#### Cursor Encoding

```javascript
// lib/pagination.js

/**
 * Encode cursor from last item
 */
function encodeCursor(item, sortKey = 'created_at') {
  const cursorData = {
    key: sortKey,
    value: item[sortKey],
    id: item.id, // Tie-breaker for identical timestamps
  };
  return Buffer.from(JSON.stringify(cursorData)).toString('base64');
}

/**
 * Decode cursor to query parameters
 */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    throw new Error('Invalid cursor');
  }
}

module.exports = { encodeCursor, decodeCursor };
```

#### Query Builder

```javascript
// controllers/jobController.js
const { encodeCursor, decodeCursor } = require('../lib/pagination');

async function listJobs(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const cursor = decodeCursor(req.query.cursor);
  
  let query = 'SELECT * FROM jobs WHERE status = $1';
  const params = ['open'];
  
  if (cursor) {
    // Add cursor condition (for created_at DESC)
    query += ' AND (created_at < $2 OR (created_at = $2 AND id < $3))';
    params.push(cursor.value, cursor.id);
  }
  
  query += ' ORDER BY created_at DESC, id DESC LIMIT $' + (params.length + 1);
  params.push(limit + 1); // Fetch one extra to check hasMore
  
  const result = await db.query(query, params);
  
  const hasMore = result.rows.length > limit;
  const jobs = result.rows.slice(0, limit);
  
  const nextCursor = hasMore ? encodeCursor(jobs[jobs.length - 1]) : null;
  
  res.json({
    success: true,
    data: jobs,
    pagination: {
      nextCursor,
      hasMore,
      limit,
    },
  });
}
```

#### Frontend Usage

```typescript
// hooks/useJobList.ts
import { useState, useEffect } from 'react';

interface Job {
  id: string;
  title: string;
  created_at: string;
}

export function useJobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  
  const loadMore = async () => {
    if (loading || !hasMore) return;
    
    setLoading(true);
    
    const url = `/api/jobs?limit=20${cursor ? `&cursor=${cursor}` : ''}`;
    const response = await fetch(url);
    const { data, pagination } = await response.json();
    
    setJobs(prev => [...prev, ...data]);
    setCursor(pagination.nextCursor);
    setHasMore(pagination.hasMore);
    setLoading(false);
  };
  
  useEffect(() => {
    loadMore();
  }, []);
  
  return { jobs, loadMore, hasMore, loading };
}
```

#### Infinite Scroll Component

```typescript
// components/JobList.tsx
import { useJobList } from '@/hooks/useJobList';
import { useInView } from 'react-intersection-observer';

export default function JobList() {
  const { jobs, loadMore, hasMore, loading } = useJobList();
  const { ref, inView } = useInView();
  
  useEffect(() => {
    if (inView && hasMore && !loading) {
      loadMore();
    }
  }, [inView, hasMore, loading]);
  
  return (
    <div>
      {jobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}
      
      {hasMore && (
        <div ref={ref} className="py-8 text-center">
          {loading ? 'Loading...' : 'Load more'}
        </div>
      )}
      
      {!hasMore && (
        <p className="text-center text-gray-500">No more jobs</p>
      )}
    </div>
  );
}
```

## Rationale

### Why Cursor-Based?

- **Performance**: O(1) query time regardless of page depth
- **Consistency**: No duplicates or missing items when data changes
- **Scalability**: Efficient with millions of records
- **Index-Friendly**: Uses indexed columns (created_at, id)
- **Real-Time Compatible**: Works with constantly changing data

### Why Not Offset-Based?

Offset-based pagination was rejected:

```sql
SELECT * FROM jobs LIMIT 20 OFFSET 1000;
```

**Problems**:
- **Slow for Deep Pages**: Database must scan and skip 1000 rows
- **Inconsistent**: If items are added/deleted, pages shift
- **O(n) Complexity**: Performance degrades linearly with offset
- **Page Drift**: User on page 5 sees duplicates if items are added

**When Offset is OK**:
- Small datasets (< 10,000 rows)
- Static data (no inserts/deletes)
- User needs page numbers

### Why Not Keyset Pagination (Seek Method)?

Keyset pagination is similar to cursor-based but exposes raw values:

```
GET /api/jobs?after_timestamp=2026-05-28T10:00:00Z&after_id=123
```

**Problems**:
- **Exposes Schema**: Reveals database column names
- **Breaking Changes**: Changing sort column breaks clients
- **Complex URLs**: Multiple parameters, harder to share
- **Coupling**: Clients must know about database structure

**Cursor-based solves this by encoding details in opaque token.**

## Consequences

### Positive

- ✅ **Fast**: O(1) query time, uses indexes
- ✅ **Consistent**: No duplicates or missing items
- ✅ **Scalable**: Efficient with millions of records
- ✅ **Simple API**: Single cursor parameter
- ✅ **Flexible**: Can change internal implementation
- ✅ **Real-Time Friendly**: Works with live data
- ✅ **Infinite Scroll**: Perfect for modern UX

### Negative

- ❌ **No Page Numbers**: Cannot jump to specific page
- ❌ **No Total Count**: Cannot show "Page 5 of 100"
- ❌ **Forward Only**: Cannot go backward (need separate cursor)
- ❌ **Stateless**: Must store cursor client-side
- ❌ **Index Required**: Needs index on sort column

## Implementation Details

### Indexing

```sql
-- Required indexes for efficient cursor queries
CREATE INDEX idx_jobs_created_at_id ON jobs(created_at DESC, id DESC);
CREATE INDEX idx_applications_created_at ON applications(created_at DESC, id DESC);
CREATE INDEX idx_messages_created_at ON private_messages(created_at DESC, id DESC);
```

### Tie-Breaking

When multiple items have the same timestamp:

```sql
-- Without tie-breaker (can miss items)
WHERE created_at < $cursor_timestamp

-- With tie-breaker (correct)
WHERE (created_at < $cursor_timestamp OR (created_at = $cursor_timestamp AND id < $cursor_id))
```

### Bidirectional Pagination

For "previous page" support:

```javascript
function encodeCursor(item, sortKey, direction = 'next') {
  return Buffer.from(JSON.stringify({
    key: sortKey,
    value: item[sortKey],
    id: item.id,
    direction, // 'next' or 'prev'
  })).toString('base64');
}

// Query for previous page
if (cursor.direction === 'prev') {
  query += ' AND (created_at > $2 OR (created_at = $2 AND id > $3))';
  query += ' ORDER BY created_at ASC, id ASC';
} else {
  query += ' AND (created_at < $2 OR (created_at = $2 AND id < $3))';
  query += ' ORDER BY created_at DESC, id DESC';
}
```

### Filtering and Sorting

Combine cursor with filters:

```javascript
let query = 'SELECT * FROM jobs WHERE 1=1';
const params = [];

// Filter by category
if (category) {
  params.push(category);
  query += ` AND category = $${params.length}`;
}

// Filter by budget
if (minBudget) {
  params.push(minBudget);
  query += ` AND budget >= $${params.length}`;
}

// Apply cursor
if (cursor) {
  params.push(cursor.value, cursor.id);
  query += ` AND (created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`;
}

query += ' ORDER BY created_at DESC, id DESC LIMIT $' + (params.length + 1);
params.push(limit + 1);
```

### Cursor Expiry

Cursors should have reasonable expiry:

```javascript
function encodeCursor(item, sortKey, ttl = 86400) {
  return Buffer.from(JSON.stringify({
    key: sortKey,
    value: item[sortKey],
    id: item.id,
    exp: Date.now() + ttl * 1000, // 24 hours
  })).toString('base64');
}

function decodeCursor(cursor) {
  const data = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  
  if (data.exp && Date.now() > data.exp) {
    throw new Error('Cursor expired');
  }
  
  return data;
}
```

### Testing

```javascript
// test/pagination.test.js
const { encodeCursor, decodeCursor } = require('../lib/pagination');

test('cursor encoding and decoding', () => {
  const item = {
    id: '123',
    created_at: '2026-05-28T10:00:00Z',
  };
  
  const cursor = encodeCursor(item);
  expect(typeof cursor).toBe('string');
  
  const decoded = decodeCursor(cursor);
  expect(decoded.id).toBe('123');
  expect(decoded.value).toBe('2026-05-28T10:00:00Z');
});

test('pagination consistency', async () => {
  // Create 50 jobs
  for (let i = 0; i < 50; i++) {
    await createJob({ title: `Job ${i}` });
  }
  
  const allJobs = [];
  let cursor = null;
  
  // Fetch all pages
  while (true) {
    const response = await fetch(`/api/jobs?limit=10${cursor ? `&cursor=${cursor}` : ''}`);
    const { data, pagination } = await response.json();
    
    allJobs.push(...data);
    
    if (!pagination.hasMore) break;
    cursor = pagination.nextCursor;
  }
  
  // Verify all 50 jobs retrieved
  expect(allJobs.length).toBe(50);
  
  // Verify no duplicates
  const ids = allJobs.map(j => j.id);
  expect(new Set(ids).size).toBe(50);
});
```

## Future Considerations

### GraphQL Relay Cursor

For GraphQL APIs, adopt Relay cursor specification:

```graphql
query {
  jobs(first: 20, after: "cursor123") {
    edges {
      node {
        id
        title
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Hybrid Approach

For admin dashboards, allow both cursor and offset:

```
GET /api/admin/jobs?page=5         # Offset-based (with page numbers)
GET /api/jobs?cursor=abc123        # Cursor-based (for users)
```

### Total Count

Add optional total count for UI:

```javascript
// Expensive, only on first page
const totalCount = cursor ? null : await db.query('SELECT COUNT(*) FROM jobs');

res.json({
  data: jobs,
  pagination: {
    nextCursor,
    hasMore,
    total: totalCount?.rows[0]?.count,
  },
});
```

## Related ADRs

- ADR-002: Horizon API for Transaction Indexing (uses cursor pagination)
- ADR-011: Query Optimization Indexes (requires proper indexing)

## References

- [Pagination in PostgreSQL](https://www.postgresql.org/docs/current/queries-limit.html)
- [Cursor-Based Pagination Best Practices](https://slack.engineering/evolving-api-pagination-at-slack/)
- [GraphQL Cursor Connections Specification](https://relay.dev/graphql/connections.htm)
- [Use the Index, Luke! - Pagination](https://use-the-index-luke.com/sql/partial-results/fetch-next-page)
- [Keyset Pagination](https://www.citusdata.com/blog/2016/03/30/five-ways-to-paginate/)
