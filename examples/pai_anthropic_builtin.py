import logfire
from pydantic_ai import Agent, CodeExecutionTool
from pydantic_ai.models.anthropic import AnthropicModelSettings

logfire.configure(service_name='testing')
logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)


person_agent = Agent(
    'gateway/anthropic:claude-sonnet-4-0',
    instructions='Use the code execution tool to execute the code',
    model_settings=AnthropicModelSettings(max_tokens=1024),
    builtin_tools=[CodeExecutionTool()],
)
result = person_agent.run_sync(
    'Can you show show me a python code that parses an YAML file and prints the keys? Make sure to test it yourself.'
)
print(repr(result.output))
