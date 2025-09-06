import pathlib
from contextlib import asynccontextmanager
from typing import cast

import httpx
import uvicorn
from rich.pretty import pprint
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
    client = httpx.AsyncClient(timeout=600)
    yield {'httpx_client': client}


async def proxy(request: Request) -> JSONResponse:
    user_agent = request.headers.get('user-agent', '')
    body = await request.body()
    auth_header = request.headers.get('authorization', '')

    if user_agent.startswith('OpenAI'):
        client = cast(httpx.AsyncClient, request.scope['state']['httpx_client'])

        url = OPENAI_BASE_URL + request.url.path
        with vcr.use_cassette(request.headers.get('x-vcr-filename', '')):  # type: ignore[reportUnknownReturnType]
            response = await client.post(
                url, content=body, headers={'Authorization': auth_header, 'content-type': 'application/json'}
            )
        pprint(response.json())
        return JSONResponse(response.json())
    raise HTTPException(status_code=400, detail='Invalid user agent')


app = Starlette(lifespan=lifespan, routes=[Route('/{path:path}', proxy, methods=['POST'])])

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8005)
