FROM python:3.11-alpine

WORKDIR /app

# git is the only program the app runs (vault commits, sync, clone). Nothing
# else is installed: no compiler, curl or perl. --no-cache keeps the apk index
# out of the image; upgrade pulls patches published since the base was built.
# Unpinned on purpose: a pinned revision disappears from the Alpine mirrors when
# it is superseded, and the point of the upgrade is the newest patches.
# hadolint ignore=DL3018
RUN apk upgrade --no-cache && apk add --no-cache git

# Create a non-root user and pre-create the logs dir with correct ownership.
# /vault and /data are where docker-compose.yml mounts the notes and the
# local store: a named volume starts with the ownership of its mount point.
RUN adduser -D -u 1000 appuser && \
    mkdir -p /app/logs /vault /data && \
    chown -R appuser:appuser /app /vault /data

COPY requirements.txt .
# setuptools and wheel only build packages, and every requirement installs from a
# wheel: removing them also removes the copies vendored inside setuptools that
# scanners flag (jaraco.context, wheel).
RUN pip install --no-cache-dir -r requirements.txt && pip uninstall -y setuptools wheel

# Only what the app runs: no tests, caches, env files or whatever else sits in
# the build context.
COPY --chown=appuser:appuser main.py ./
COPY --chown=appuser:appuser config ./config
COPY --chown=appuser:appuser models ./models
COPY --chown=appuser:appuser routes ./routes
COPY --chown=appuser:appuser scripts ./scripts
COPY --chown=appuser:appuser services ./services

USER 1000

EXPOSE 8000

# No curl in the image: Python's own client asks the API docs page.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/docs', timeout=4)"]

# --proxy-headers/--forwarded-allow-ips: trust X-Forwarded-Proto from the
# ingress (Traefik terminates TLS and forwards plain HTTP internally).
# Without this, request.url_for() in routes/auth.py builds the Google OAuth
# redirect_uri as http://... instead of https://..., which Google rejects
# with redirect_uri_mismatch since only the https variant is registered.
# --ws-max-size: the WebSockets (/ws/screen, /ws/sync) are server-to-client —
# screens and open documents never send anything — so there's no reason to
# buffer uvicorn's default 16MB per incoming message from an unauthenticated
# client.
# --timeout-graceful-shutdown: on SIGTERM, open connections (a track being
# streamed, a screen's socket) get 10s, then shutdown goes on, so the
# lifespan's final save of the live documents runs well within the
# kubelet's 30s before SIGKILL; it was skipped while a stream held on.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info", "--proxy-headers", "--forwarded-allow-ips=*", "--ws-max-size", "1024", "--timeout-graceful-shutdown", "10"]
