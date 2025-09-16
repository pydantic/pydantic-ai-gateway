"""This example implements all the possible parts for the Anthropic API."""

from pathlib import Path

import logfire
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models.anthropic import AnthropicModelSettings

logfire.configure(service_name='testing')
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)


kiwi_image = Path(__file__).parent / 'assets' / 'kiwi.jpg'


agent = Agent(
    'gateway:anthropic/claude-sonnet-4-0',
    instructions='Extract information about the image.',
    model_settings=AnthropicModelSettings(
        anthropic_thinking={'type': 'enabled', 'budget_tokens': 1024},
        top_p=0.95,
        stop_sequences=['potato'],
        presence_penalty=0.5,
    ),
)
result = agent.run_sync([BinaryContent(data=kiwi_image.read_bytes(), media_type='image/jpeg')])
print(repr(result.output))
