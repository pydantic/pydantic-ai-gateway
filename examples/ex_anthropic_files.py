import os
from pathlib import Path

import anthropic
import logfire as lf
from rich.pretty import pprint

lf.configure()
lf.instrument_httpx(capture_all=True)

current_dir = Path(__file__).parent
sample_pdf = current_dir / 'assets' / 'sample.pdf'

auth_token = os.environ['PYDANTIC_AI_GATEWAY_API_KEY'].strip()
assert auth_token

client = anthropic.Anthropic(base_url='http://localhost:8787/anthropic', auth_token=auth_token)
file_metadata = client.beta.files.upload(file=(sample_pdf.name, open(sample_pdf, 'rb'), 'application/pdf'))
pprint(file_metadata)

response = client.beta.messages.create(
    model='claude-sonnet-4-5',
    max_tokens=1024,
    messages=[
        {
            'role': 'user',
            'content': [
                {'type': 'text', 'text': 'Read this document and summarize the main points.'},
                {'type': 'document', 'source': {'type': 'file', 'file_id': file_metadata.id}},
            ],
        }
    ],
    betas=['files-api-2025-04-14'],
)
pprint(response)
