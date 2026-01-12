import asyncio

import logfire
from pydantic_ai import Agent

logfire.configure(service_name='testing', send_to_logfire=False)
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)

person_agent = Agent(
    'gateway/anthropic:claude-haiku-4-5',
    instructions='You are a helpful assistant.',
    model_settings={'max_tokens': 1024},
    retries=0,
)


async def main():
    async for event in person_agent.run_stream_events('What is the capital of France?'):
        print(repr(event))


if __name__ == '__main__':
    asyncio.run(main())
