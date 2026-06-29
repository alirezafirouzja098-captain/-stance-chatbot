"""Supabase dual-write store for news embeddings (runs alongside Qdrant).

When Supabase credentials are configured, this module mirrors embedding
upserts into the Supabase `news_embeddings` table (pgvector).  This allows
the Next.js frontend to perform vector similarity search directly via
Supabase RPC without hitting the Qdrant/Python backend.

If Supabase is not configured, all operations are silently skipped.
"""

from __future__ import annotations

import logging
from typing import Optional

from config.settings import settings
from ingestion.models import ArticleChunk

logger = logging.getLogger(__name__)

# ── Lazy client ─────────────────────────────────────────────

_client: Optional[object] = None
_is_available: Optional[bool] = None


def _get_client():
    """Lazily initialize the Supabase client.  Returns None if unconfigured."""
    global _client, _is_available

    if _is_available is not None:
        return _client

    if not settings.supabase_url or not settings.supabase_service_key:
        _is_available = False
        logger.info("Supabase credentials not configured — dual-write disabled")
        return None

    try:
        from supabase import create_client
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
        _is_available = True
        logger.info("Supabase client initialized for dual-write at %s", settings.supabase_url)
        return _client
    except ImportError:
        _is_available = False
        logger.warning("supabase-py not installed — dual-write disabled (pip install supabase)")
        return None
    except Exception as exc:
        _is_available = False
        logger.warning("Failed to initialize Supabase client: %s", exc)
        return None


# ── Public API ──────────────────────────────────────────────


def upsert_chunks_to_supabase(
    chunks: list[ArticleChunk],
    vectors: list[list[float]],
) -> int:
    """
    Mirror article chunk embeddings into Supabase's news_embeddings table.

    Uses upsert semantics (ON CONFLICT on url + chunk_index).
    Returns the number of rows written, or 0 if Supabase is unavailable.
    """
    client = _get_client()
    if client is None:
        return 0

    rows = []
    for chunk, vector in zip(chunks, vectors):
        rows.append({
            "title": chunk.title,
            "content": chunk.text,
            "source": chunk.source,
            "url": chunk.url,
            "published_date": chunk.published_date.isoformat(),
            "category": chunk.category,
            "chunk_index": chunk.chunk_index,
            "embedding": vector,
        })

    # Batch upsert in groups of 100
    batch_size = 100
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        try:
            result = (
                client.table("news_embeddings")
                .upsert(batch, on_conflict="url,chunk_index")
                .execute()
            )
            total += len(batch)
            logger.debug("Supabase upserted batch %d–%d", i, i + len(batch))
        except Exception as exc:
            logger.warning("Supabase upsert failed for batch %d–%d: %s", i, i + len(batch), exc)

    logger.info("Supabase dual-write: upserted %d rows into news_embeddings", total)
    return total
