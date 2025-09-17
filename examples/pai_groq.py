from datetime import date

import logfire
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent
from pydantic_ai.models.groq import GroqModelSettings

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
    'gateway:groq/openai/gpt-oss-120b',
    output_type=Person,
    instructions='Extract information about the person',
    model_settings=GroqModelSettings(stop_sequences=['potato'], temperature=0.5, top_p=0.9),
)
result = person_agent.run_sync("Samuel lived in London and was born on Jan 28th '87")
print(repr(result.output))
