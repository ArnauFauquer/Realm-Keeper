import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

# A log file is rotated at this size, keeping this many old ones: the log
# directory is a pod's scratch volume, which a long-running pod would fill.
LOG_FILE_BYTES = 10 * 1024 * 1024
LOG_FILE_BACKUPS = 3
# Libraries that are chatty at DEBUG (every S3 request, every connection).
QUIET_LOGGERS = ("botocore", "boto3", "s3transfer", "urllib3", "httpx", "httpcore", "multipart")


def setup_logging(log_level: str = "INFO", log_dir: Optional[Path] = None) -> logging.Logger:
    """Configures the root logger, so every module's logger — `get_logger`'s
    "realm_keeper.*" ones and the plain `logging.getLogger(__name__)` ones
    alike — reaches the console and the log files. (Only "realm_keeper" was
    configured before: the hub's, the documents' and the Observatory's logs
    were dropped, and their errors reached neither error.log nor a
    timestamp.) Uvicorn's own loggers don't propagate here, so nothing is
    written twice."""
    log_level = log_level.upper()
    valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
    if log_level not in valid_levels:
        log_level = "INFO"
    level = getattr(logging, log_level)

    root = logging.getLogger()
    root.setLevel(level)
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()

    formatter = logging.Formatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    root.addHandler(console_handler)

    if log_dir:
        log_dir.mkdir(parents=True, exist_ok=True)
        for filename, file_level in (("app.log", level), ("error.log", logging.ERROR)):
            handler = RotatingFileHandler(
                log_dir / filename, maxBytes=LOG_FILE_BYTES, backupCount=LOG_FILE_BACKUPS, encoding="utf-8",
            )
            handler.setLevel(file_level)
            handler.setFormatter(formatter)
            root.addHandler(handler)

    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(max(level, logging.WARNING))

    logger = logging.getLogger("realm_keeper")
    logger.setLevel(level)
    return logger


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"realm_keeper.{name}")
