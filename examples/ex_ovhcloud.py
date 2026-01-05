import os

from openai import OpenAI

api_key = os.getenv('PYDANTIC_AI_GATEWAY_API_KEY')
assert api_key is not None

client = OpenAI(api_key=api_key, base_url='http://localhost:8787/ovhcloud')

completion = client.chat.completions.create(
    model='gpt-oss-120b',
    messages=[{'role': 'user', 'content': 'What is the capital of France?'}],
)

print(completion.choices[0].message)
