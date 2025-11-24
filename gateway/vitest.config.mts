/** biome-ignore-all lint/style/useNamingConvention: env vars */
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

// This is a fake private key, it doesn't have access to any resources, but it's a valid private key.
const FAKE_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGBAMFrZYX4gZ20qv88',
  'jD0QCswXgcxgP7Ta06G47QEFprDVcv4WMUBDJVAKofzVcYyhsasWsOSxcpA8LIi9',
  '/VS2Otf8CmIK6nPBCD17Qgt8/IQYXOS4U2EBh0yjo0HQ4vFpkqium4lLWxrAZohA',
  '8r82clV08iLRUW3J+xvN23iPHyVDAgMBAAECgYBScRJe3iNxMvbHv+kOhe30O/jJ',
  'QiUlUzhtcEMk8mGwceqHvrHTcEtRKJcPC3NQvALcp9lSQQhRzjQ1PLXkC6BcfKFd',
  '03q5tVPmJiqsHbSyUyHWzdlHP42xWpl/RmX/DfRKGhPOvufZpSTzkmKWtN+7osHu',
  '7eiMpg2EDswCvOgf0QJBAPXLYwHbZLaM2KEMDgJSse5ZTE/0VMf+5vSTGUmHkr9c',
  'Wx2G1i258kc/JgsXInPbq4BnK9hd0Xj2T5cmEmQtm4UCQQDJc02DFnPnjPnnDUwg',
  'BPhrCyW+rnBGUVjehveu4XgbGx7l3wsbORTaKdCX3HIKUupgfFwFcDlMUzUy6fPO',
  'IuQnAkA8FhVE/fIX4kSO0hiWnsqafr/2B7+2CG1DOraC0B6ioxwvEqhHE17T5e8R',
  '5PzqH7hEMnR4dy7fCC+avpbeYHvVAkA5W58iR+5Qa49r/hlCtKeWsuHYXQqSuu62',
  'zW8QWBo+fYZapRsgcSxCwc0msBm4XstlFYON+NoXpUlsabiFZOHZAkEA8Ffq3xoU',
  'y0eYGy3MEzxx96F+tkl59lfkwHKWchWZJ95vAKWJaHx9WFxSWiJofbRna8Iim6pY',
  'BootYWyTCfjjwA==',
  '-----END PRIVATE KEY-----',
].join('\\n')

const FAKE_SERVICE_ACCOUNT_KEY = `
{
  "client_email": "test@example.com",
  "private_key": "${FAKE_PRIVATE_KEY}",
  "project_id": "pydantic-ai"
}
`

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
            AZURE_API_KEY: process.env.AZURE_API_KEY ?? 'AZURE_API_KEY-unset',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'OPENAI_API_KEY-unset',
            GROQ_API_KEY: process.env.GROQ_API_KEY ?? 'GROQ_API_KEY-unset',
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'ANTHROPIC_API_KEY-unset',
            AWS_BEARER_TOKEN_BEDROCK: process.env.AWS_BEARER_TOKEN_BEDROCK ?? 'AWS_BEARER_TOKEN_BEDROCK-unset',
            GOOGLE_SERVICE_ACCOUNT_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? FAKE_SERVICE_ACCOUNT_KEY,
          },
        },
      },
    },
  },
})
