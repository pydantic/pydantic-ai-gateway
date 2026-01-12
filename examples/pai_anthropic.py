from datetime import date

import logfire
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModelSettings

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
    'gateway/anthropic:claude-haiku-4-5',
    output_type=Person,
    instructions='Extract information about the person',
    model_settings=AnthropicModelSettings(max_tokens=1024),
)
result = person_agent.run_sync("Samuel lived in London and was born on Jan 28th '87")
print(repr(result.output))
