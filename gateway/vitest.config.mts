import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // from https://github.com/cloudflare/workers-sdk/issues/6581#issuecomment-2653472683
    testTimeout: 60000,
    setupFiles: './test/setup.ts',
    resolveSnapshotPath: (testPath, snapshotExtension) => testPath + snapshotExtension,
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['@pydantic/logfire-cf-workers', '@opentelemetry/resources', 'mime-types', 'mime-db'],
        },
      },
    },
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: './test/wrangler.jsonc' },
        miniflare: {
          bindings: {
            OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'OPENAI_API_KEY-unset',
            GROQ_API_KEY: process.env.GROQ_API_KEY ?? 'GROQ_API_KEY-unset',
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'ANTHROPIC_API_KEY-unset',
          },
        },
      },
    },
  },
})
