import asyncio
import os
from datetime import date

import logfire
from anthropic import AsyncAnthropicVertex
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel, AnthropicModelSettings
from pydantic_ai.providers.anthropic import AnthropicProvider

logfire.configure(service_name='testing')
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)


class Person(BaseModel, use_attribute_docstrings=True):
    name: str
    """The name of the person."""
    dob: date
    """The date of birth of the person. MUST BE A VALID ISO 8601 date."""
    city: str
    """The city where the person lives."""

    @field_validator('dob')
    def validate_dob(cls, v: date) -> date:
        if v >= date(1900, 1, 1):
            raise ValueError('The person must be born in the 19th century')
        return v


api_key = os.environ['PYDANTIC_AI_GATEWAY_API_KEY']

client = AsyncAnthropicVertex(
    base_url='http://localhost:8787/google-vertex', access_token=api_key, region='unknown', project_id='unknown'
)
provider = AnthropicProvider(anthropic_client=client)
model = AnthropicModel('claude-sonnet-4', provider=provider)

person_agent = Agent(
    model=model,
    output_type=Person,
    instructions='Extract information about the person',
    model_settings=AnthropicModelSettings(max_tokens=1024),
)


async def main():
    result = await person_agent.run("Samuel lived in London and was born on Jan 28th '87")
    print(repr(result.output))


if __name__ == '__main__':
    asyncio.run(main())
