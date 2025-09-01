.DEFAULT_GOAL := all

.PHONY: .npm
.npm: ## Check that npm is installed
	@npm --version || echo 'Please install npm: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm'

.PHONY: .uv
.uv: ## Check that uv is installed
	@uv --version || echo 'Please install uv: https://docs.astral.sh/uv/getting-started/installation/'

.PHONY: .pre-commit
.pre-commit: ## Check that pre-commit is installed
	@pre-commit -V || echo 'Please install pre-commit: https://pre-commit.com/'

.PHONY: install
install: .npm .uv .pre-commit ## Install the package, dependencies, and pre-commit for local development
	npm install
	uv sync --frozen --all-extras
	pre-commit install --install-hooks
	# this make wrangler significantly faster in some scenarios - https://github.com/cloudflare/workers-sdk/issues/9946
	npx wrangler telemetry disable
	npm run typegen

.PHONY: format-ts
format-ts: ## Format TS and JS code
	npm run format

.PHONY: format-py
format-py: ## Format Python code
	uv run ruff format
	uv run ruff check --fix --fix-only

.PHONY: format
format: format-ts format-py ## Format all code

.PHONY: lint-ts
lint-ts: ## Lint TS and JS code
	npm run lint

.PHONY: lint-py
lint-py: ## Lint Python code
	uv run ruff format --check
	uv run ruff check

.PHONY: lint
lint:  lint-ts lint-py ## Lint all code

.PHONY: typecheck-ts
typecheck-ts: ## Typecheck TS and JS code
	npm run typecheck

.PHONY: typecheck-py
typecheck-py: ## Typecheck the code
	uv run basedpyright

.PHONY: typecheck
typecheck: typecheck-ts typecheck-py ## Typecheck all code

.PHONY: test-ts
test-ts: ## Run TS and JS tests
	CI=1 npm run test

.PHONY: test
test: test-ts ## Run all tests

.PHONY: dev
dev: ## Run the OSS gateway locally
	npm run dev

.PHONY: deploy
deploy: ## Run the OSS gateway locally
	npm run deploy

.PHONY: ci-setup
ci-setup: ## Setup CI environment
	cp -n deploy/example.config.ts deploy/src/config.ts || true
	cp -n deploy/example.env.local deploy/.env.local || true

.PHONY: all
all: format typecheck test ## run format, typecheck and test

.PHONY: help
help: ## Show this help (usage: make help)
	@echo "Usage: make [recipe]"
	@echo "Recipes:"
	@awk '/^[a-zA-Z0-9_-]+:.*?##/ { \
		helpMessage = match($$0, /## (.*)/); \
		if (helpMessage) { \
			recipe = $$1; \
			sub(/:/, "", recipe); \
			printf "  \033[36m%-20s\033[0m %s\n", recipe, substr($$0, RSTART + 3, RLENGTH); \
		} \
	}' $(MAKEFILE_LIST)
