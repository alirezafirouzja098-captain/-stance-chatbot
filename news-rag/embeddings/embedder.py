"""Generate embeddings via Ollama's /api/embed endpoint."""

from __future__ import annotations

import logging
import time

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)

# nomic-embed-text produces 768-dimensional vectors
EMBEDDING_DIM = 768

# Maximum texts per batch request
_BATCH_SIZE = 32

# Retry configuration
_MAX_RETRIES = 3
_INITIAL_BACKOFF = 1.0  # seconds


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using Ollama's embed API.

    Texts are batched into groups of at most ``_BATCH_SIZE`` for efficiency.
    Returns one 768-dim vector per input text in the same order.
    """
    if not texts:
        return []

    all_embeddings: list[list[float]] = []

    for start in range(0, len(texts), _BATCH_SIZE):
        batch = texts[start : start + _BATCH_SIZE]
        embeddings = _embed_batch(batch)
        all_embeddings.extend(embeddings)

        logger.debug(
            "Embedded batch %d–%d / %d",
            start,
            start + len(batch),
            len(texts),
        )

    return all_embeddings


def _embed_batch(texts: list[str]) -> list[list[float]]:
    """Send a single batch to Ollama and return the embedding vectors."""
    url = f"{settings.ollama_host}/api/embed"
    payload = {
        "model": settings.ollama_embed_model,
        "input": texts,
    }

    backoff = _INITIAL_BACKOFF
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                return data["embeddings"]
        except (httpx.HTTPStatusError, httpx.ConnectError, KeyError) as exc:
            logger.warning(
                "Embed attempt %d/%d failed: %s",
                attempt,
                _MAX_RETRIES,
                exc,
            )
            if attempt < _MAX_RETRIES:
                time.sleep(backoff)
                backoff *= 2
            else:
                raise RuntimeError(
                    f"Failed to embed batch after {_MAX_RETRIES} retries"
                ) from exc

    # Should never reach here, but keeps type checkers happy
    raise RuntimeError("Embedding failed unexpectedly")


def embed_query(text: str) -> list[float]:
    """Embed a single query string. Convenience wrapper."""
    vectors = embed_texts([text])
    return vectors[0]
