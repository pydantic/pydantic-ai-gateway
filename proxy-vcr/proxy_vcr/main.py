from __future__ import annotations as _annotations

import hashlib
import pathlib
from contextlib import asynccontextmanager
from typing import cast

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from vcr import VCR  # type: ignore[reportMissingTypeStubs]
from vcr.record_mode import RecordMode  # type: ignore[reportMissingTypeStubs]

OPENAI_BASE_URL = 'https://api.openai.com/v1/'
GROQ_BASE_URL = 'https://api.groq.com'
ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
BEDROCK_BASE_URL = 'https://bedrock-runtime.us-east-1.amazonaws.com'

current_file_dir = pathlib.Path(__file__).parent

# TODO(Marcelo): We should create different cassette directories: PydanticAI and Gateway test suites.

vcr = VCR(
    serializer='yaml',
    cassette_library_dir=(current_file_dir / 'cassettes').as_posix(),
    record_mode=RecordMode.ONCE,
    match_on=['uri', 'method'],
    filter_headers=['Authorization', 'x-api-key'],
)


@asynccontextmanager
async def lifespan(_: Starlette):
    async with httpx.AsyncClient(timeout=600) as client:
        yield {'httpx_client': client}


async def proxy(request: Request) -> JSONResponse:
    auth_header = request.headers.get('authorization', '')
    body = await request.body()

    # We should cache based on request body content, so we should make a hash of the request body.
    body_hash = hashlib.sha256(body).hexdigest()

    if request.url.path.startswith('/openai'):
        client = cast(httpx.AsyncClient, request.scope['state']['httpx_client'])
        url = OPENAI_BASE_URL + request.url.path.strip('/openai')
        with vcr.use_cassette(f'{body_hash}.yaml'):  # type: ignore[reportUnknownReturnType]
            headers = {'Authorization': auth_header, 'content-type': 'application/json'}
            response = await client.post(url, content=body, headers=headers)
    elif request.url.path.startswith('/groq'):
        client = cast(httpx.AsyncClient, request.scope['state']['httpx_client'])
        url = GROQ_BASE_URL + request.url.path[len('/groq') :]
        with vcr.use_cassette(f'{body_hash}.yaml'):  # type: ignore[reportUnknownReturnType]
            headers = {'Authorization': auth_header, 'content-type': 'application/json'}
            response = await client.post(url, content=body, headers=headers)
    elif request.url.path.startswith('/bedrock'):
        client = cast(httpx.AsyncClient, request.scope['state']['httpx_client'])
        url = BEDROCK_BASE_URL + request.url.path[len('/bedrock') :]
        with vcr.use_cassette(f'{body_hash}.yaml'):  # type: ignore[reportUnknownReturnType]
            headers = {
                'Authorization': auth_header,
                'content-type': 'application/json',
                'x-amz-security-token': auth_header.replace('Bearer ', ''),
            }
            response = await client.post(url, content=body, headers=headers)
    elif request.url.path.startswith('/anthropic'):
        client = cast(httpx.AsyncClient, request.scope['state']['httpx_client'])
        url = ANTHROPIC_BASE_URL + request.url.path[len('/anthropic') :]
        api_key = auth_header.replace('Bearer ', '')
        with vcr.use_cassette(f'{body_hash}.yaml'):  # type: ignore[reportUnknownReturnType]
            anthropic_beta_headers = {}
            if anthropic_beta := request.headers.get('anthropic-beta'):
                anthropic_beta_headers = {'anthropic-beta': anthropic_beta}

            headers = {
                'x-api-key': api_key,
                'content-type': 'application/json',
                'anthropic-version': request.headers.get('anthropic-version', '2023-06-01'),
                **anthropic_beta_headers,
            }
            response = await client.post(url, content=body, headers=headers)
    else:
        raise HTTPException(status_code=404, detail=f'Path {request.url.path} not supported')
    return JSONResponse(response.json(), status_code=response.status_code)


async def health_check(_: Request) -> Response:
    return Response(status_code=204)


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route('/{path:path}', proxy, methods=['POST']),
        Route('/', health_check, methods=['GET']),
    ],
)

if __name__ == '__main__':
    this_dir = pathlib.Path(__file__).parent
    uvicorn.run('proxy_vcr.main:app', host='0.0.0.0', port=8005, reload=True, reload_dirs=[str(this_dir)])
