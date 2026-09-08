# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build the frontend ----------
# Bun runs the same `tsc -b && vite build` we use locally. Alpine is the
# smallest official Bun image and works fine for pure-JS builds.
FROM oven/bun:1-alpine AS frontend

WORKDIR /build

# Install deps first so source changes don't invalidate the install layer.
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile

# Vite bakes VITE_* env vars into the JS bundle at build time, so the
# Spotify client id has to be present here — it can't be swapped later at
# container start. Pass via `docker build --build-arg VITE_SPOTIFY_CLIENT_ID=…`
# or through docker-compose's `build.args`.
ARG VITE_SPOTIFY_CLIENT_ID
ENV VITE_SPOTIFY_CLIENT_ID=${VITE_SPOTIFY_CLIENT_ID}

# Then bring in the source and build.
COPY frontend/ .
RUN bun run build


# ---------- Stage 2: runtime (FastAPI + built static) ----------
# Astral's official uv image ships uv preinstalled on a Python 3.12 slim
# base — one image to reason about, and uv sits on PATH out of the box.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS runtime

WORKDIR /app

# Deps first for layer caching. `--no-install-project` because our
# pyproject.toml sets `package = false`; we don't build an app package.
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Backend source
COPY backend/app ./app

# Built frontend from stage 1
COPY --from=frontend /build/dist ./static

# Persistent data lives here; typically mounted as a volume in prod.
RUN mkdir -p /data

ENV STATIC_DIR=/app/static \
    DATABASE_URL=sqlite:////data/app.db \
    PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Uvicorn straight from the synced venv. No `uv run` at runtime — one less
# thing to boot each time, and everything's already installed.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
