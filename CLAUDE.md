# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pydantic AI Gateway (PAIG) is an AI API gateway that proxies requests to multiple AI providers (OpenAI, Anthropic, Google Vertex, Groq, AWS Bedrock). It provides API key management, spending limits, cost tracking, and OpenTelemetry observability. Built as a TypeScript monorepo deployed on Cloudflare Workers.

**License:** AGPL-3.0

## Repository Structure

This is a monorepo with two npm workspaces:

- **`gateway/`**: Core library (`@pydantic/ai-gateway`) that implements the gateway proxy logic. Can be published and consumed independently.
- **`deploy/`**: Cloudflare Workers deployment wrapper that configures and runs the gateway with D1 database and KV store, config is stored in a typescript `config.ts` file.

Additional directories:
- **`examples/`**: Python example scripts demonstrating various provider integrations
- **`proxy-vcr/`**: HTTP recording/replay tool for testing

## Development Setup

```bash
make install              # Install all dependencies (npm, uv, pre-commit hooks)
npm run typegen           # Generate TypeScript types from Cloudflare bindings
```

## Code Quality

```bash
make lint                 # Lint TypeScript and Python
npm run lint              # Lint TypeScript only (uses Biome)
make format               # Format TypeScript and Python
npm run format            # Format TypeScript only (uses Biome)
make typecheck            # Type-check TypeScript and Python
npm run typecheck         # Type-check all workspaces (uses tsgo)
```

### Testing

To run tests, you need Redis and the VCR proxy running. Start them with:

```bash
docker-compose up -d
```

Then run tests:

```bash
make test                 # Run all tests
npm run test              # Run all workspace tests with CI=1
npm run test-gateway      # Run gateway workspace tests
npm run test-deploy       # Run deploy workspace tests
```

To run a single test file:
```bash
npm run test-gateway -- auth.spec.ts
npm run test-deploy -- index.spec.ts
```

Tests use Vitest with the Cloudflare Workers test pool to simulate the Workers runtime environment. Test configuration automatically loads the Wrangler config.

Tests are defined in `gateway/test/*.spec.ts` and `deploy/test/*.spec.ts` files.

IMPORTANT: when writing tests make sure they're minimal and concise - with tests often less is more, MOST IMPORTANTLY make sure they match the style and patterns of other tests.

Always run tests, e.g. with `npm run test` or `npm run test -- <file>` after editing or adding tests to make sure tests are all passing
