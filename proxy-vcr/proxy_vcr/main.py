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
from starlette.responses import JSONResponse
from starlette.routing import Route
from vcr import VCR  # type: ignore[reportMissingTypeStubs]
from vcr.record_mode import RecordMode  # type: ignore[reportMissingTypeStubs]

OPENAI_BASE_URL = 'https://api.openai.com/v1'


current_file_dir = pathlib.Path(__file__).parent

vcr = VCR(
    serializer='yaml',
    cassette_library_dir=(current_file_dir / 'cassettes').as_posix(),
    record_mode=RecordMode.ONCE,
    match_on=['uri', 'method'],
    filter_headers=['Authorization'],
)


@asynccontextmanager
async def lifespan(_: Starlette):
    async with httpx.AsyncClient(timeout=600) as client:
        yield {'httpx_client': client}


async def proxy(request: Request) -> JSONResponse:
    user_agent = request.headers.get('user-agent', '')
    auth_header = request.headers.get('authorization', '')
    body = await request.body()

    # We should cache based on request body content, so we should make a hash of the request body.
    body_hash = hashlib.sha256(body).hexdigest()

    if user_agent.startswith('OpenAI'):
        client = cast(httpx.AsyncClient, request.scope['state']['httpx_client'])

        url = OPENAI_BASE_URL + request.url.path
        with vcr.use_cassette(f'{body_hash}.yaml'):  # type: ignore[reportUnknownReturnType]
            headers = {'Authorization': auth_header, 'content-type': 'application/json'}
            response = await client.post(url, content=body, headers=headers)
        return JSONResponse(response.json())
    raise HTTPException(status_code=400, detail='Invalid user agent')


app = Starlette(lifespan=lifespan, routes=[Route('/{path:path}', proxy, methods=['POST'])])

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8005)
