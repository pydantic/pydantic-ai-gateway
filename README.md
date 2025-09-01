# Pydantic AI Gateway

An AI Gateway from Pydantic (PAIG)

## Why

> Everyone's building AI Gateways, why should I use Pydantic's?

Good question, there's a few reasons:

- Excellent integration with [Pydantic AI](https://ai.pydantic.dev)
- Excellent integration with [Pydantic Logfire](https://pydantic.dev/logfire/), or indeed any Open Telemetry service
- No "API harmonization" (because Pydantic AI can support all popular models) we don't need to attempt to convert all model responses to one schema, meaning you can use all features of all models as soon as they're released. All PAIG needs to be able to do is authorize requests to that provider
- Open source with commercial support - you can configure PAIG directly in code and deploy it yourself, or use our hosted service with a convenient UI and API to configure it, we also offer self-hosting of PAIG for enterprise customers
- API key delegation and cost limiting - use one provider key across many teams, users and API keys with fine-grained control over usage and costs at each level
- (TODO) Caching - cache responses to avoid unnecessary API calls and improve performance
- (TODO) Fallback - if a provider is down or rate limited, PAIG can automatically switch to another provider
- (TODO) Security
- (TODO) Code execution, web search and RAG knowledge base all with the same API key

## Deploying PAIG

You can deploy PAIG yourself on CloudFlare workers, very easily:

First, clone this repo.

Next configure you the gateway:

You'll also want to set some secrets for CloudFlare's wrangler, you will probably want to start from the example config:

(This command and all subsequent commands should be run from the root of the repo)

```bash
cp deploy/example.env.local deploy/.env.local
```

Then edit `deploy/.env.local` to set secrets. This will set secrets for local testing and also alloy you to setup types for
the cloudflare env, when you've added variables to `.env.local`, run

```bash
npm run typegen
```

Next, configure teams, users, providers and API keys by editing `./deploy/src/config.ts`, you will probably want to start from the example config:

```bash
cp deploy/example.config.ts deploy/src/config.ts
```

Then edit `./deploy/src/config.ts` to set up PAIG.

Next, initialize the limits local database (this is used to keep track of costs and block requests that exceed limits)

```bash
npm run limits-local-db
```

Once your worker is setup, you can run it locally to test it

```bash
npm run dev
```

You can then connect to the gateway at the URL printed by the dev server.

Once you're happy with the setup, you can deploy it to CloudFlare workers:

- create a CloudFlare account and setup wrangler with `npx wrangler login`
- set any secrets with `npm run wrangler-secret-put <secret_name>`
- initialize the limits db with `npm run limits-remote-db`
- finally, deploy the worker with `npm run deploy`

Whenever you make changes to the gateway config (`./deploy/src/config.ts`) you'll need to re-run `npm run deploy` to update the worker.
