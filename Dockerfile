# Production image: FastAPI serves the API and the built React UI from one origin.
FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY frontend/react-web/package.json frontend/react-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/react-web/index.html frontend/react-web/vite.config.js ./
COPY frontend/react-web/src ./src
COPY frontend/react-web/public ./public
RUN npm run build

FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# One worker per vCPU; uvicorn reads this. AI rate limits are counted per worker, so the effective ceiling is limit x workers.
ENV WEB_CONCURRENCY=2
WORKDIR /srv/techprep
COPY services/api-fastapi/requirements.txt services/api-fastapi/requirements.txt
RUN pip install -r services/api-fastapi/requirements.txt
COPY services/api-fastapi/app services/api-fastapi/app
COPY --from=web /build/dist frontend/react-web/dist
# Named volumes inherit this ownership on first use, so the non-root user can write its database.
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin techprep \
    && mkdir -p /data /releases && chown techprep:techprep /data
USER techprep
WORKDIR /srv/techprep/services/api-fastapi
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]
# Only the Caddy container (fixed address on a private network) may set the client address headers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "172.30.0.10", "--no-server-header"]
