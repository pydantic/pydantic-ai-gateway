import asyncio
from datetime import date

import logfire
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent

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


person_agent = Agent(
    'gateway/openai:gpt-5',
    instructions='You are a helpful assistant.',
    model_settings={'max_tokens': 1024},
    retries=2,
    output_type=Person,
)


async def main():
    async for event in person_agent.run_stream_events("Samuel lived in London and was born on Jan 28th '87"):
        print(repr(event))


if __name__ == '__main__':
    asyncio.run(main())
