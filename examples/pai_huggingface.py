import os
from datetime import date

import logfire
from huggingface_hub import AsyncInferenceClient
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent, __version__
from pydantic_ai.models.huggingface import HuggingFaceModel
from pydantic_ai.providers.huggingface import HuggingFaceProvider

logfire.configure(service_name='testing')
logfire.instrument_pydantic_ai()
logfire.instrument_aiohttp_client(capture_all=True)
print('pydantic-ai version:', __version__)


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


api_key = os.getenv('PYDANTIC_AI_GATEWAY_API_KEY')
# api_key = os.getenv('HF_TOKEN')
assert api_key is not None
base_url = 'http://localhost:8787/huggingface'
# base_url = None

hf_client = AsyncInferenceClient(api_key=api_key, provider='novita', base_url=base_url)
provider = HuggingFaceProvider(hf_client=hf_client)
model = HuggingFaceModel('moonshotai/Kimi-K2-Thinking', provider=provider)

person_agent = Agent(
    model=model,
    output_type=Person,
    instructions='Extract information about the person',
)
result = person_agent.run_sync("Samuel lived in London and was born on Jan 28th '87")
print(repr(result.output))
