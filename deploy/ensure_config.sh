#!/bin/bash

CONFIG_FILE="src/config.ts"
DEV_CONFIG_FILE="src/config-dev.ts"

# If config.ts doesn't exist, copy config-dev.ts to config.ts
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Creating $CONFIG_FILE from $DEV_CONFIG_FILE..."
  cp "$DEV_CONFIG_FILE" "$CONFIG_FILE"
  echo -e "\033[32m✓ Config file created successfully\033[0m"
  exit 0
fi

# If config.ts exists, check if it's the same as config-dev.ts
if cmp -s "$CONFIG_FILE" "$DEV_CONFIG_FILE"; then
  # Files are identical, nothing to do
  exit 0
fi

# Files are different, prompt user
echo -e "\033[33mWarning: $CONFIG_FILE exists and differs from $DEV_CONFIG_FILE\033[0m"
echo ""
read -p "Do you want to replace it with the dev config? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Backup the current config with timestamp
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  BACKUP_FILE="${CONFIG_FILE}.backup.${TIMESTAMP}"
  echo "Backing up current config to $BACKUP_FILE..."
  cp "$CONFIG_FILE" "$BACKUP_FILE"

  # Replace with dev config
  cp "$DEV_CONFIG_FILE" "$CONFIG_FILE"
  echo -e "\033[32m✓ Config file updated successfully\033[0m"
  echo -e "\033[36m  Previous config backed up to $BACKUP_FILE\033[0m"
else
  echo "Keeping existing config file."
  exit 0
fi
