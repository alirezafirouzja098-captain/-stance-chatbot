"""Structured logging configuration."""

import logging
import sys

from config.settings import settings


def setup_logging() -> None:
    """Configure root logger with structured format."""
    log_format = (
        "%(asctime)s | %(levelname)-8s | %(name)-25s | %(message)s"
    )
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format=log_format,
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )
    # Silence noisy third-party loggers
    for name in ("httpx", "httpcore", "urllib3", "qdrant_client"):
        logging.getLogger(name).setLevel(logging.WARNING)
