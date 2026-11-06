# Multi-stage: bake the Vite UI, run with Python stdlib only.
FROM node:22-bookworm-slim AS ui
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SAFECOLLAPSE_DOCKER=1 \
    SAFECOLLAPSE_DATA=/data \
    PORT=8765

COPY build_index.py serve.py trace_api.py ./
COPY --from=ui /src/dist ./dist

# Empty cache dir; filled at startup (or via a mounted host .cache).
RUN mkdir -p /app/.cache /data \
 && useradd --create-home --uid 1000 viewer \
 && chown -R viewer:viewer /app
USER viewer

EXPOSE 8765
HEALTHCHECK --interval=10s --timeout=3s --start-period=90s --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=2)"

CMD ["python", "serve.py", "--data", "/data", "--cache", "/app/.cache", "--host", "0.0.0.0", "--port", "8765"]
