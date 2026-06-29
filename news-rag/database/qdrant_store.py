"""Qdrant vector database operations."""

from __future__ import annotations

import logging
import uuid

from qdrant_client import QdrantClient, models

from config.settings import settings
from embeddings.embedder import EMBEDDING_DIM
from ingestion.models import ArticleChunk, RetrievedChunk

logger = logging.getLogger(__name__)

# ── Singleton client ────────────────────────────────────────

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    """Return (and lazily create) the Qdrant client singleton."""
    global _client
    if _client is None:
        try:
            # Attempt to connect to the configured host with a short timeout
            _client = QdrantClient(url=settings.qdrant_host, timeout=3.0)
            # Ping with a light call to verify
            _client.get_collections()
            logger.info("Connected to Qdrant server at %s", settings.qdrant_host)
        except Exception as exc:
            logger.warning(
                "Could not connect to Qdrant server at %s: %s. Falling back to local storage (qdrant_db).",
                settings.qdrant_host,
                exc
            )
            _client = QdrantClient(path="qdrant_db")
            logger.info("Initialized local Qdrant database in 'qdrant_db'")
    return _client


# ── Collection management ──────────────────────────────────


def init_collection() -> None:
    """
    Create the ``news`` collection if it does not already exist.

    Sets up the vector configuration (768-dim cosine) and payload
    indexes for efficient filtered search.
    """
    client = get_client()
    collection_name = settings.qdrant_collection

    existing = [c.name for c in client.get_collections().collections]
    if collection_name in existing:
        logger.info("Collection '%s' already exists — skipping creation", collection_name)
        _ensure_indexes(client, collection_name)
        return

    client.create_collection(
        collection_name=collection_name,
        vectors_config=models.VectorParams(
            size=EMBEDDING_DIM,
            distance=models.Distance.COSINE,
        ),
    )
    logger.info("Created Qdrant collection '%s'", collection_name)
    _ensure_indexes(client, collection_name)


def _ensure_indexes(client: QdrantClient, collection_name: str) -> None:
    """Create payload indexes for filterable fields."""
    index_fields = {
        "source": models.PayloadSchemaType.KEYWORD,
        "category": models.PayloadSchemaType.KEYWORD,
        "published_date": models.PayloadSchemaType.DATETIME,
        "url": models.PayloadSchemaType.KEYWORD,
    }
    for field_name, schema_type in index_fields.items():
        try:
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field_name,
                field_schema=schema_type,
            )
        except Exception:
            # Index may already exist — that's fine
            pass
    logger.info("Payload indexes ensured for %s", list(index_fields.keys()))


# ── Deduplication ───────────────────────────────────────────


def url_exists(url: str) -> bool:
    """Check whether any point with the given URL already exists."""
    client = get_client()
    result = client.scroll(
        collection_name=settings.qdrant_collection,
        scroll_filter=models.Filter(
            must=[
                models.FieldCondition(
                    key="url",
                    match=models.MatchValue(value=url),
                )
            ]
        ),
        limit=1,
    )
    return len(result[0]) > 0


# ── Upsert ──────────────────────────────────────────────────


def upsert_chunks(
    chunks: list[ArticleChunk],
    vectors: list[list[float]],
) -> int:
    """
    Upsert article chunks with their embedding vectors into Qdrant.

    Returns the number of points successfully upserted.
    """
    if not chunks:
        return 0

    client = get_client()
    points: list[models.PointStruct] = []

    for chunk, vector in zip(chunks, vectors):
        points.append(
            models.PointStruct(
                id=str(uuid.uuid4()),
                vector=vector,
                payload=chunk.to_payload(),
            )
        )

    # Batch upsert in groups of 100
    batch_size = 100
    total = 0
    for i in range(0, len(points), batch_size):
        batch = points[i : i + batch_size]
        client.upsert(
            collection_name=settings.qdrant_collection,
            points=batch,
        )
        total += len(batch)
        logger.debug("Upserted batch %d–%d", i, i + len(batch))

    logger.info("Upserted %d points into '%s'", total, settings.qdrant_collection)
    return total


# ── Search ──────────────────────────────────────────────────


def search_chunks(
    query_vector: list[float],
    top_k: int = 20,
    source: str | None = None,
    category: str | None = None,
    date_from: str | None = None,
) -> list[RetrievedChunk]:
    """
    Search the news collection with optional metadata filters.

    Args:
        query_vector: The embedded query.
        top_k: Number of results to retrieve.
        source: Filter by source name (exact match).
        category: Filter by category (exact match).
        date_from: ISO-8601 datetime string — only return articles
                   published on or after this date.

    Returns:
        A list of ``RetrievedChunk`` objects ordered by relevance.
    """
    client = get_client()

    # Build filter conditions
    must_conditions: list[models.Condition] = []
    if source:
        must_conditions.append(
            models.FieldCondition(
                key="source",
                match=models.MatchValue(value=source),
            )
        )
    if category:
        must_conditions.append(
            models.FieldCondition(
                key="category",
                match=models.MatchValue(value=category),
            )
        )
    if date_from:
        must_conditions.append(
            models.FieldCondition(
                key="published_date",
                range=models.Range(gte=date_from),
            )
        )

    query_filter = (
        models.Filter(must=must_conditions) if must_conditions else None
    )

    results = client.query_points(
        collection_name=settings.qdrant_collection,
        query=query_vector,
        query_filter=query_filter,
        limit=top_k,
    )

    retrieved: list[RetrievedChunk] = []
    for point in results.points:
        p = point.payload or {}
        retrieved.append(
            RetrievedChunk(
                text=p.get("text", ""),
                title=p.get("title", ""),
                source=p.get("source", ""),
                url=p.get("url", ""),
                published_date=p.get("published_date", ""),
                category=p.get("category", ""),
                score=point.score if point.score else 0.0,
            )
        )

    return retrieved


def collection_stats() -> dict:
    """Return basic stats about the news collection."""
    client = get_client()
    try:
        info = client.get_collection(settings.qdrant_collection)
        points = getattr(info, "points_count", 0)
        vectors = getattr(info, "vectors_count", 0)
        status_val = getattr(info, "status", None)
        if status_val and hasattr(status_val, "value"):
            status = status_val.value
        else:
            status = str(status_val) if status_val else "unknown"
        return {
            "points_count": points,
            "vectors_count": vectors,
            "status": status,
        }
    except Exception as exc:
        logger.warning("Could not retrieve collection stats: %s", exc)
        return {"error": str(exc)}
