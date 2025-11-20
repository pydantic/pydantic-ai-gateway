import asyncio

import logfire
from pydantic_ai import Agent, BinaryImage

logfire.configure(service_name='testing')
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)

person_agent = Agent(
    'gateway/google-vertex:gemini-2.5-flash-image',
    # 'google-vertex:gemini-2.5-flash',
    instructions='You are a helpful assistant.',
    model_settings={'max_tokens': 1024},
    retries=0,
    output_type=BinaryImage,
)


async def main():
    async with person_agent.run_stream('A potato image!') as result:
        async for message in result.stream_output():
            print(message)
    # output = await result.get_output()
    # print(repr(output))


if __name__ == '__main__':
    asyncio.run(main())
