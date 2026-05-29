.PHONY: dev test test-api test-web lint fmt build clean

dev:
	./scripts/dev.sh

test:
	uv run pytest packages/api/tests -q
	cd packages/web && pnpm test

test-api:
	uv run pytest packages/api/tests -v

test-web:
	cd packages/web && pnpm test

lint:
	uv run ruff check packages/api
	uv run mypy packages/api
	cd packages/web && pnpm lint && pnpm build

fmt:
	uv run ruff check --fix packages/api
	uv run ruff format packages/api
	cd packages/web && pnpm exec biome check --write src tests

build:
	cd packages/web && pnpm install && pnpm build
	mkdir -p packages/api/blogforge/static
	cp -R packages/web/dist/* packages/api/blogforge/static/
	uv build

clean:
	rm -rf packages/web/dist packages/api/blogforge/static dist build *.egg-info
	rm -rf .pytest_cache .ruff_cache .mypy_cache
