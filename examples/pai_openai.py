import os
from datetime import date

import logfire
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider

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


os.environ['GROQ_BASE_URL'] = 'http://localhost:8787/groq'
person_agent = Agent(
    OpenAIModel(
        'gpt-4.1-mini',
        provider=OpenAIProvider(
            base_url='http://localhost:8787/openai',
            # base_url='https://pydantic-ai-gateway.pydantic.workers.dev/openai',
            api_key='VOE4JMpVGr71RgvEEidPCXd4ov42L24ODw9q5RI7uYc',
        ),
    ),
    output_type=Person,
    instructions='Extract information about the person',
)
result = person_agent.run_sync("Samuel lived in London and was born on Jan 28th '87")
print(repr(result.output))
