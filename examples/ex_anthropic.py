import logfire
from anthropic import Anthropic

logfire.configure()
logfire.instrument_httpx(capture_all=True)

client = Anthropic()
print(client.base_url)

response = client.beta.messages.create(
    model='claude-sonnet-4-0',
    max_tokens=1024,
    messages=[
        {'role': 'assistant', 'content': 'You are a helpful assistant.'},
        {'role': 'user', 'content': 'what color is the sky?'},
    ],
)

print(response.content)
