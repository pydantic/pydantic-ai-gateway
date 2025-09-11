import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // from https://github.com/cloudflare/workers-sdk/issues/6581#issuecomment-2653472683
    testTimeout: 30000,
    resolveSnapshotPath: (testPath, snapshotExtension) => testPath + snapshotExtension,
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['@pydantic/logfire-cf-workers', '@opentelemetry/resources', '@pydantic/ai-gateway'],
        },
      },
    },
    alias: {
      './config': '../test.config.ts',
    },
    poolOptions: {
      workers: {
        wrangler: {
          isolatedStorage: true,
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          bindings: {
            OPENAI_API_KEY: `${process.env.OPENAI_API_KEY}`,
            GROQ_API_KEY: `${process.env.GROQ_API_KEY}`,
            GOOGLE_SERVICE_ACCOUNT_KEY: `${process.env.GOOGLE_SERVICE_ACCOUNT_KEY}`,
          },
        },
      },
    },
  },
})
