import os

import logfire
from devtools import debug
from openai import OpenAI

logfire.configure()
logfire.instrument_httpx(capture_all=True)

api_key = os.getenv('PYDANTIC_AI_GATEWAY_API_KEY')
assert api_key is not None

client = OpenAI(api_key=api_key, base_url='http://localhost:8787/azure')

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
