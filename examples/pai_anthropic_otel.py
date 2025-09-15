"""This example implements all the possible parts for the Anthropic API."""

from pathlib import Path

import logfire
from pydantic_ai import Agent, BinaryContent

logfire.configure(service_name='testing')
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)


kiwi_image = Path(__file__).parent / 'assets' / 'kiwi.jpg'


agent = Agent(
    'gateway:anthropic/claude-sonnet-4-0',
    instructions='Extract information about the image.',
)
result = agent.run_sync([BinaryContent(data=kiwi_image.read_bytes(), media_type='image/jpeg')])
print(repr(result.output))
