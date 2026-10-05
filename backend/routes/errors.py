"""What the routes share to turn what the services raise into HTTP errors, and
to keep blocking work (S3, git, the disk) off the event loop."""
import asyncio
import functools
import logging
from logging import Logger

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from services.doc_collection import DocNotFound

logger = logging.getLogger(__name__)


def storage_unavailable(logger: Logger, e: Exception) -> HTTPException:
    logger.error(f"Object storage error: {e}")
    return HTTPException(status_code=502, detail="Could not reach object storage")


async def blocking(fn, *args):
    """Runs `fn(*args)` in a thread: whatever waits on storage or git there
    doesn't hold up the sockets, which share the event loop."""
    return await asyncio.to_thread(fn, *args)


def guarded(handler):
    """Turns what a handler raises into the HTTP error it means: DocNotFound
    is 404, PermissionError 403, any other ValueError 400 (the caller's
    mistake), and a storage error 502."""
    @functools.wraps(handler)
    async def wrapper(*args, **kwargs):
        try:
            return await handler(*args, **kwargs)
        except DocNotFound as e:
            raise HTTPException(status_code=404, detail=str(e))
        except PermissionError:
            raise HTTPException(status_code=403, detail="Not allowed")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except (ClientError, BotoCoreError) as e:
            raise storage_unavailable(logger, e)
    return wrapper
