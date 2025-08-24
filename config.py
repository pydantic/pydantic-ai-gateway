from __future__ import annotations

import hashlib
import json
import re
import secrets
import subprocess
import sys
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import cast

from genai_prices.types import ProviderID
from pydantic import BaseModel, Field, ValidationError, field_serializer, field_validator
from pydantic_core.core_schema import ValidationInfo
from ruamel.yaml import YAML


class _Model(BaseModel, extra='forbid', use_attribute_docstrings=True):
    """Custom abstract based model with config"""


class ConfigPy(_Model):
    org: str
    teams: list[TeamPy]
    providers: list[ProviderProxy]
    api_keys: list[ApiKey] = Field(alias='apiKeys')

    @field_validator('api_keys')
    @classmethod
    def teams_exist(cls, api_keys: list[ApiKey], info: ValidationInfo) -> list[ApiKey]:
        team_names: set[str] = set()
        user_names: set[str] = set()
        for team in cast(list[TeamPy], info.data.get('teams', [])):
            team_names.add(team.name)
            for user in team.users:
                user_names.add(user.name)

        providers: list[ProviderProxy] = info.data.get('providers', [])
        provider_names = set(provider.name for provider in providers)
        for key in api_keys:
            if key.team not in team_names:
                raise ValueError(f'Team {key.team!r} does not exist')
            if key.user and key.user not in user_names:
                raise ValueError(f'User {key.user!r} does not exist')
            for provider_name in key.providers:
                if provider_name not in provider_names:
                    raise ValueError(f'Provider {provider_name!r} does not exist')
        return api_keys


class ConfigTs(_Model):
    org: str
    teams: dict[str, TeamTs]
    providers: dict[str, ProviderProxy]
    api_keys: dict[str, ApiKey] = Field(serialization_alias='apiKeys')


class TeamPy(_Model):
    name: str
    otel_write_token: str | None = Field(default=None, alias='otelWriteToken')
    otel_base_url: str | None = Field(default=None, alias='otelBaseUrl')
    """if unset the base url is derived from the Pydantic Logfire writeToken"""
    users: list[User]
    spending_limit_daily: int | None = Field(default=None, alias='spendingLimitDaily')
    spending_limit_weekly: int | None = Field(default=None, alias='spendingLimitWeekly')
    spending_limit_monthly: int | None = Field(default=None, alias='spendingLimitMonthly')

    def team_ts(self) -> TeamTs:
        return TeamTs(
            name=self.name,
            otel_write_token=self.otel_write_token,
            otel_base_url=self.otel_base_url,
            users={user.name: user for user in self.users},
            spending_limit_daily=self.spending_limit_daily,
            spending_limit_weekly=self.spending_limit_weekly,
            spending_limit_monthly=self.spending_limit_monthly,
        )


class TeamTs(_Model):
    name: str
    otel_write_token: str | None = Field(default=None, serialization_alias='otelWriteToken')
    otel_base_url: str | None = Field(default=None, serialization_alias='otelBaseUrl')
    users: dict[str, User]
    spending_limit_daily: int | None = Field(default=None, serialization_alias='spendingLimitDaily')
    spending_limit_weekly: int | None = Field(default=None, serialization_alias='spendingLimitWeekly')
    spending_limit_monthly: int | None = Field(default=None, serialization_alias='spendingLimitMonthly')


class ProxySchema(StrEnum):
    openai = 'openai'
    anthropic = 'anthropic'


class ProviderProxy(_Model):
    name: str
    base_url: str = Field(alias='baseUrl')
    provider_id: ProviderID = Field(alias='providerId')
    inject_price: bool = Field(default=True, alias='injectPrice')
    credentials: str


class User(_Model):
    name: str
    otel_write_token: str | None = Field(default=None, alias='otelWriteToken')
    otel_base_url: str | None = Field(default=None, alias='otelBaseUrl')
    """if unset the base url is derived from the Pydantic Logfire writeToken"""
    spending_limit_daily: int | None = Field(default=None, alias='spendingLimitDaily')
    spending_limit_weekly: int | None = Field(default=None, alias='spendingLimitWeekly')
    spending_limit_monthly: int | None = Field(default=None, alias='spendingLimitMonthly')


class ApiKey(_Model):
    api_key: str = Field(alias='apiKey')
    team: str
    user: str | None = None
    expires: datetime | None = None
    spending_limit_daily: int | None = Field(default=None, alias='spendingLimitDaily')
    spending_limit_weekly: int | None = Field(default=None, alias='spendingLimitWeekly')
    spending_limit_monthly: int | None = Field(default=None, alias='spendingLimitMonthly')
    spending_limit_total: int | None = Field(default=None, alias='spendingLimitTotal')
    providers: list[str]

    @field_serializer('expires')
    @staticmethod
    def expires_as_unix(value: datetime | None) -> int | None:
        if value is None:
            return None
        return int(value.timestamp() * 1000)


config_schema_file = Path('config.schema.json')
config_file = Path('config.yaml')
typescript_content_path = Path('oss-gateway/src/config.ts')
template_config_file = f"""\
# yaml-language-server: $schema={config_schema_file.name}

# update this file to configure the Pydantic AI Gateway
# then run `uv run config.py` again to generate the TypeScript config file

org: my-org

teams:
  - name: default
    # logfire write token to send data to logfire,
    # can also set otelBaseUrl to send data to any other OTel endpoint
    otelWriteToken: ...  # optional but recommended
    # limits in $, all spending limits are optional
    spendingLimitDaily: 10
    spendingLimitWeekly: 50
    spendingLimitMonthly: 100
    users:
      - name: samuel
        # spendingLimitDaily: 5
        # spendingLimitWeekly: 25
        # spendingLimitMonthly: 75

providers:
  - name: openai
    baseUrl: https://api.openai.com/v1
    providerId: openai
    # if credentials starts with 'env::' the value will be read from cloudflare env/secrets
    credentials: env::OPENAI_API_KEY

apiKeys:
  - apiKey: {secrets.token_urlsafe()}
    team: default
    user: samuel  # this is optional
    providers: [openai]
    # spendingLimitDaily: 5
    # spendingLimitWeekly: 25
    # spendingLimitMonthly: 75
    # spendingLimitTotal: 100
"""


def main() -> int:
    data_json_schema = ConfigPy.model_json_schema()
    config_schema_file.write_text(json.dumps(data_json_schema, indent=2))

    if not config_file.exists():
        config_file.write_text(template_config_file)
        print(f'Config file {config_file} created.')
        print('\nInstructions:')
        print(f'* update {config_file} to configure the gateway')
        print('* run `uv run config.py` again to generate the TypeScript config file')

    try:
        with config_file.open('r') as f:
            raw_config = YAML().load(f)  # type: ignore[reportUnknownVariableType]
    except Exception as e:
        print(f'YAML Error:\n{e}', file=sys.stderr)
        return 1

    try:
        config_py = ConfigPy.model_validate(raw_config)
    except ValidationError as e:
        print(f'Error validating {config_file.name}:\n{e}', file=sys.stderr)
        return 1

    config_ts = ConfigTs(
        org=config_py.org,
        teams={team.name: team.team_ts() for team in config_py.teams},
        providers={provider.name: provider for provider in config_py.providers},
        api_keys={api_key.api_key: api_key for api_key in config_py.api_keys},
    )

    config_json = config_ts.model_dump_json(by_alias=True, exclude_none=True)
    # replace 'env::*' strings with env lookups
    config_json, count = re.subn(r':"env::(.+?)"', r':env.\1', config_json)
    if count:
        print(f'Replaced {count} env:: placeholders')

    typescript_content = f"""\
// DO NOT EDIT THIS FILE DIRECTLY, INSTEAD:
// Edit {config_file} to configure the gateway, then run `make config` to write this file

import type {{ Config }} from './types'

export const CONFIG_HASH = '{hashlib.sha1(config_json.encode()).hexdigest()}'

export function getConfig(env: Env): Config {{
  return {config_json}
}}
"""
    typescript_content_path.write_text(typescript_content)
    subprocess.run(
        ['npx', 'prettier', str(typescript_content_path), '--write', '--ignore-path'],
        check=True,
        stdout=subprocess.PIPE,
    )
    print(f'Config updated in {typescript_content_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
