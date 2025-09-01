# Pydantic AI Gateway deploy

This directory contains code for deploying the Pydantic AI Gateway as a simple "headless" cloudflare worker.

In this mode there's no UI, instead the gateway is configured by editing `src/config.ts` and redeploying the worker.

See the [parent README](../README.md) for more information.
