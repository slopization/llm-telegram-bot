FROM ghcr.io/astral-sh/uv:0.13.1 AS uv

FROM node:24.21.0-slim AS node-packages

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  COREPACK_HOME=/tmp/corepack

WORKDIR /sandbox
COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --frozen-lockfile --prod --store-dir /tmp/pnpm-store

FROM python:3.14.8-slim-trixie

RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-nanum \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1000 sandbox \
  && useradd --uid 1000 --gid 1000 --home-dir /tmp --no-create-home --shell /bin/bash sandbox

COPY --from=node-packages /usr/local/bin/node /usr/local/bin/node
COPY --from=node-packages /sandbox/node_modules /sandbox/node_modules

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
  UV_PYTHON=/usr/local/bin/python3 \
  UV_PYTHON_DOWNLOADS=never \
  UV_COMPILE_BYTECODE=1 \
  UV_LINK_MODE=copy \
  UV_NO_CACHE=1

WORKDIR /opt/sandbox
COPY pyproject.toml uv.lock ./
RUN --mount=from=uv,source=/uv,target=/usr/local/bin/uv uv sync --frozen --no-dev

ENV PATH=/opt/venv/bin:$PATH \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1

COPY <<EOF /opt/matplotlib/matplotlibrc
backend: Agg
font.family: NanumGothic, DejaVu Sans
font.sans-serif: NanumGothic, DejaVu Sans
axes.unicode_minus: True
EOF
RUN MPLCONFIGDIR=/opt/matplotlib python -c "import matplotlib.pyplot"

# matplotlib replaces a non-writable MPLCONFIGDIR with an empty temp dir and rebuilds
# the font cache, so the prebuilt files are linked into the writable /tmp at startup.
COPY <<EOF /opt/venv/lib/python3.14/site-packages/sitecustomize.py
import os

PREBUILT_DIR = "/opt/matplotlib"
RUNTIME_DIR = "/tmp/matplotlib"

try:
    os.mkdir(RUNTIME_DIR)
    for name in os.listdir(PREBUILT_DIR):
        os.symlink(os.path.join(PREBUILT_DIR, name), os.path.join(RUNTIME_DIR, name))
except OSError:
    pass
EOF
ENV MPLCONFIGDIR=/tmp/matplotlib

USER 1000:1000
WORKDIR /tmp
