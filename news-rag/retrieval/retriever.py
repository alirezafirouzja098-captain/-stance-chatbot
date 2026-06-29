"""Retrieve relevant news chunks for a user query."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from database.qdrant_store import search_chunks
from embeddings.embedder import embed_query
from ingestion.models import RetrievedChunk

logger = logging.getLogger(__name__)


def retrieve(
    query: str,
    top_k: int = 20,
    source: str | None = None,
    category: str | None = None,
    days: int | None = None,
) -> list[RetrievedChunk]:
    """
    Embed the user *query* and retrieve the top-k most relevant
    news chunks from Qdrant, with optional metadata filters.

    Args:
        query: Natural-language question.
        top_k: How many chunks to retrieve from the vector store.
        source: Optional source filter (e.g. "BBC News").
        category: Optional category filter (e.g. "technology").
        days: If set, only return articles from the last N days.

    Returns:
        A list of ``RetrievedChunk`` objects ordered by cosine similarity.
    """
    logger.info("Retrieving for query: '%s' (top_k=%d)", query[:80], top_k)

    # 1. Embed the query
    query_vector = embed_query(query)

    # 2. Build date filter
    date_from: str | None = None
    if days is not None and days > 0:
        cutoff = datetime.now() - timedelta(days=days)
        date_from = cutoff.isoformat()

    # 3. Search Qdrant
    chunks = search_chunks(
        query_vector=query_vector,
        top_k=top_k,
        source=source,
        category=category,
        date_from=date_from,
    )

    logger.info("Retrieved %d chunks from vector store", len(chunks))
    return chunks
