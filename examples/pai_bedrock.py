import os

import boto3
import logfire
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor  # type: ignore[reportUnknownReturnType]
from pydantic_ai import Agent
from pydantic_ai.models.bedrock import BedrockConverseModel
from pydantic_ai.providers.bedrock import BedrockProvider

# Instrument Botocore
logfire.configure()
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)
BotocoreInstrumentor().instrument()

api_key = os.getenv('PYDANTIC_AI_GATEWAY_API_KEY')
assert api_key is not None
os.environ['AWS_BEARER_TOKEN_BEDROCK'] = api_key


client = boto3.client('bedrock-runtime', endpoint_url='http://localhost:8787/bedrock')  # type: ignore[reportUnknownReturnType]
provider = BedrockProvider(bedrock_client=client)
model = BedrockConverseModel('amazon.nova-micro-v1:0', provider=provider)


agent = Agent(
    model=model,
    instructions='You are a helpful assistant.',
)


@agent.tool_plain
def capital_of(name: str) -> str:
    return f'The capital of {name} is Paris'


result = agent.run_sync('What is the capital of France?')
print(result.output)
