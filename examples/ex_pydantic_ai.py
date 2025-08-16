from datetime import date

import logfire
from pydantic import BaseModel
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
    """The date of birth of the person."""
    city: str
    """The city where the person lives."""


person_agent = Agent(
    OpenAIModel(
        'gpt-4.1-mini',
        provider=OpenAIProvider(
            base_url='http://localhost:8787/gateway/openai',
            api_key='VOE4JMpVGr71RgvEEidPCXd4ov42L24ODw9q5RI7uYc',
        ),
    ),
    # OpenAIModel(
    #     'openai/gpt-oss-120b',
    #     provider=OpenAIProvider(
    #         base_url='http://localhost:8787/gateway/groq',
    #         api_key='VOE4JMpVGr71RgvEEidPCXd4ov42L24ODw9q5RI7uYc',
    #     ),
    # ),
    output_type=Person,
    instructions='Extract information about the person',
)
result = person_agent.run_sync("Samuel lived in London and was born on Jan 28th '87")
print(repr(result.output))
