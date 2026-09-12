FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Create a non-root user and pre-create the logs dir with correct ownership
RUN useradd -m -u 1000 appuser && \
    mkdir -p /app/logs && \
    chown -R appuser:appuser /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chown -R appuser:appuser /app

USER 1000

EXPOSE 8000

# --proxy-headers/--forwarded-allow-ips: trust X-Forwarded-Proto from the
# ingress (Traefik terminates TLS and forwards plain HTTP internally).
# Without this, request.url_for() in routes/auth.py builds the Google OAuth
# redirect_uri as http://... instead of https://..., which Google rejects
# with redirect_uri_mismatch since only the https variant is registered.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info", "--proxy-headers", "--forwarded-allow-ips=*"]
