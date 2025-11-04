import logfire
from devtools import debug
from openai import OpenAI

logfire.configure()
logfire.instrument_httpx(capture_all=True)

client = OpenAI(
    api_key='_api_key_',
    base_url='http://localhost:8787/openai',
    # base_url='https://gateway.pydantic.dev/proxy/openai',
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
