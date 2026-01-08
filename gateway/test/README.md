# Testing

## Running Tests with Services

The tests require both Redis and proxy-vcr to be running. The easiest way is to use docker-compose:

### Quick Start

```bash
# Start all services (Redis + proxy-vcr)
make services-up

# Run tests
npm test

# Stop services when done
make services-down
```

### Manual Docker Compose

```bash
# Start services and wait for them to be healthy
docker-compose up -d --wait

# Run tests
npm test

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Cache-Specific Testing

The cache tests include tests for both Redis and Cloudflare KV functionality. These tests will automatically skip if Redis is not available.

### Running Only Cache Tests

```bash
# With services running
npm run test -- cache.spec.ts
```

### Without Services

If you run tests without Redis, the Redis tests will gracefully skip:

```bash
npm run test -- cache.spec.ts
# Output: ⚠ Redis not available, skipping Redis tests
# Result: 3 KV tests pass, 7 Redis tests skip
```

## Custom Redis Connection

You can customize the Redis connection using environment variables:

```bash
REDIS_HOST=my-redis-server REDIS_PORT=6380 npm test
```

## CI Configuration

The GitHub Actions workflow (`.github/workflows/ci.yml`) uses docker-compose to start all services:

```yaml
- name: Start Redis and proxy-vcr services
  run: docker-compose up -d

- name: Wait for services to be healthy
  run: |
    timeout 60 bash -c 'until docker-compose ps | grep -q "healthy"; do sleep 2; done'
```

This ensures:
- ✅ All Redis tests run in CI (no skipped tests)
- ✅ Proxy-VCR is available for other tests
- ✅ Services are properly health-checked before tests run
- ✅ Services are cleaned up after tests complete

## Test Behavior

| Scenario | Result |
|----------|--------|
| **Services running** | All 10 tests run (7 Redis + 3 KV) |
| **No Redis** | 7 Redis tests skip, 3 KV tests run |
| **CI Pipeline** | All 10 tests run (services auto-started) |

The Redis tests use database 15 to avoid conflicts with other Redis data.
