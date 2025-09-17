import os

import logfire
from devtools import debug
from openai import OpenAI

logfire.configure()
logfire.instrument_httpx(capture_all=True)


GATEWAY_API_KEY = os.getenv('GATEWAY_API_KEY')
assert GATEWAY_API_KEY, 'GATEWAY_API_KEY is not set'

client = OpenAI(
    api_key=GATEWAY_API_KEY,
    base_url='http://localhost:8787/openai',
    # base_url='https://pydantic-ai-gateway.pydantic.workers.dev/openai',
)

response = client.responses.create(
    model='gpt-4.1',
    instructions='reply concisely',
    input='what color is the sky?',
)

print(response.output_text)
response.usage

completion = client.chat.completions.create(
    model='gpt-4.1',
    messages=[
        {'role': 'developer', 'content': 'You are a helpful assistant.'},
        {'role': 'user', 'content': 'what color is the sky?'},
    ],
)
debug(completion)
completion.usage
