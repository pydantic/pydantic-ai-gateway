import os

import logfire
from devtools import debug
from openai import OpenAI

logfire.configure()
logfire.instrument_httpx(capture_all=True)

api_key = os.getenv('PYDANTIC_AI_GATEWAY_API_KEY')
assert api_key is not None

# We only support `/v1/chat/completions`, not `/chat/completions`.
client = OpenAI(api_key=api_key, base_url='http://localhost:8787/anthropic/v1')

completion = client.chat.completions.create(
    model='claude-sonnet-4-5',
    messages=[
        {'role': 'developer', 'content': 'You are a helpful assistant.'},
        {'role': 'user', 'content': 'what color is the sky?'},
    ],
)
debug(completion)
completion.usage
