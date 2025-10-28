from __future__ import annotations

import json
import os
import sys
from typing import TYPE_CHECKING

import boto3
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from mypy_boto3_bedrock_runtime import BedrockRuntimeClient

del os.environ['AWS_ACCESS_KEY_ID']
del os.environ['AWS_DEFAULT_REGION']
del os.environ['AWS_SECRET_ACCESS_KEY']

api_key = os.getenv('PYDANTIC_AI_GATEWAY_API_KEY')
assert api_key is not None, 'PYDANTIC_AI_GATEWAY_API_KEY is not set'
os.environ['AWS_BEARER_TOKEN_BEDROCK'] = api_key

# Create a Bedrock Runtime client in the AWS Region you want to use.
client: BedrockRuntimeClient = boto3.client(  # type: ignore[reportUnknownReturnType]
    'bedrock-runtime', region_name='us-east-1', endpoint_url='http://localhost:8787/bedrock'
)

# Set the model ID, e.g., Claude 3 Haiku.
model_id = 'anthropic.claude-3-haiku-20240307-v1:0'


def invoke():
    # Format the request payload using the model's native structure.
    native_request = {
        'anthropic_version': 'bedrock-2023-05-31',
        'max_tokens': 512,
        'temperature': 0.5,
        'messages': [
            {
                'role': 'user',
                'content': [{'type': 'text', 'text': "Describe the purpose of a 'hello world' program in one line."}],
            }
        ],
    }

    # Convert the native request to JSON.
    request = json.dumps(native_request)

    try:
        # Invoke the model with the request.
        response = client.invoke_model(modelId=model_id, body=request, contentType='application/json')

    except (ClientError, Exception) as e:
        print(f"ERROR: Can't invoke '{model_id}'. Reason: {e}")
        exit(1)

    # Decode the response body.
    model_response = json.loads(response['body'].read())

    # Extract and print the response text.
    response_text = model_response['content'][0]['text']
    print(response_text)


def converse():
    try:
        # Send the message to the model, using a basic inference configuration.
        response = client.converse(
            modelId=model_id,
            messages=[
                {
                    'role': 'user',
                    'content': [{'text': "Describe the purpose of a 'hello world' program in one line."}],
                }
            ],
            inferenceConfig={'maxTokens': 512, 'temperature': 0.5, 'topP': 0.9},
        )

        # Extract and print the response text.
        response_text = response['output']['message']['content'][0]['text']  # type: ignore[reportUnknownMemberType]
        print(response_text)

    except (ClientError, Exception) as e:
        print(f"ERROR: Can't invoke '{model_id}'. Reason: {e}")
        exit(1)


if __name__ == '__main__':
    # Either pass `invoke` or `converse` as the first argument
    if sys.argv[1] == 'invoke':
        invoke()
    elif sys.argv[1] == 'converse':
        converse()
    else:
        print('Usage: python ex_anthropic_bedrock.py [invoke|converse]')
        sys.exit(1)
