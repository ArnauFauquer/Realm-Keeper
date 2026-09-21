"""Shared HTTP error helpers for routes that talk to S3-compatible storage."""
from logging import Logger

from fastapi import HTTPException


def storage_unavailable(logger: Logger, e: Exception) -> HTTPException:
    logger.error(f"Object storage error: {e}")
    return HTTPException(status_code=502, detail="Could not reach object storage")
