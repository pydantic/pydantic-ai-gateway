#!/bin/bash

if [ ! -f "src/config.ts" ]; then
  echo -e "\033[31mError: deploy/src/config.ts does not exist!\033[0m"
  echo ""
  echo "Please copy example.config.ts to src/config.ts and update it with your configuration:"
  echo -e "\033[36m  cp deploy/example.config.ts deploy/src/config.ts\033[0m"
  echo ""
  echo "Then edit deploy/src/config.ts with your API keys and settings."
  exit 1
fi
