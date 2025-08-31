from datetime import date

import logfire
from google.genai import Client
from google.genai.types import HttpOptionsDict
from pydantic import BaseModel, field_validator
from pydantic_ai import Agent
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers import Provider

logfire.configure(service_name='testing')
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)
logfire.instrument_aiohttp_client()


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


class GoogleGatewayProvider(Provider[Client]):
    def __init__(
        self, provider_name: str, api_key: str, gateway_url: str = 'https://pydantic-ai-gateway.pydantic.workers.dev'
    ) -> None:
        self.provider_name = provider_name
        self.gateway_url = gateway_url
        http_options: HttpOptionsDict = {
            'headers': {
                'Authorization': api_key,
            },
            'base_url': self.base_url,
        }
        self._client = Client(http_options=http_options, api_key='unset')

    @property
    def name(self) -> str:
        return 'google'

    @property
    def base_url(self) -> str:
        return f'{self.gateway_url}/{self.provider_name}'

    @property
    def client(self) -> Client:
        return self._client


person_agent = Agent(
    GoogleModel(
        'gemini-2.5-flash',
        provider=GoogleGatewayProvider(
            'google',
            'VOE4JMpVGr71RgvEEidPCXd4ov42L24ODw9q5RI7uYc',
            gateway_url='http://localhost:8787',
        ),
    ),
    output_type=Person,
    instructions='Extract information about the person',
)
result = person_agent.run_sync("Samuel lived in London and was born on Jan 28th '87")
print(repr(result.output))
