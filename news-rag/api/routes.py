"""FastAPI route definitions."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException

from api.generator import generate_answer
from api.schemas import (
    HealthResponse,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    ServiceStatus,
)
from config.settings import settings
from database.qdrant_store import (
    collection_stats,
    init_collection,
    upsert_chunks,
    url_exists,
)
from database.supabase_store import upsert_chunks_to_supabase
from embeddings.embedder import embed_texts
from ingestion.chunker import chunk_article
from ingestion.cleaner import clean_html
from ingestion.fetcher import fetch_feeds
from ingestion.models import ArticleChunk
from reranking.reranker import rerank
from retrieval.retriever import retrieve

logger = logging.getLogger(__name__)

router = APIRouter()


# ── POST /ingest ────────────────────────────────────────────


@router.post("/ingest", response_model=IngestResponse)
def ingest_feeds() -> IngestResponse:
    """
    Trigger the full ingestion pipeline:
    fetch → clean → chunk → embed → upsert.
    """
    logger.info("Starting ingestion pipeline …")

    # 1. Fetch
    articles = fetch_feeds(settings.feed_urls)

    # 2. Clean + chunk + deduplicate
    all_chunks: list[ArticleChunk] = []
    duplicates = 0

    for article in articles:
        if url_exists(article.url):
            duplicates += 1
            continue

        cleaned = clean_html(article.content)
        if not cleaned:
            continue

        chunks = chunk_article(article, cleaned)
        all_chunks.extend(chunks)

    logger.info(
        "Prepared %d chunks from %d articles (%d duplicates skipped)",
        len(all_chunks),
        len(articles),
        duplicates,
    )

    if not all_chunks:
        return IngestResponse(
            articles_fetched=len(articles),
            chunks_created=0,
            chunks_embedded=0,
            points_upserted=0,
            duplicates_skipped=duplicates,
        )

    # 3. Embed
    texts = [c.text for c in all_chunks]
    vectors = embed_texts(texts)

    # 4. Upsert into Qdrant (primary store)
    upserted = upsert_chunks(all_chunks, vectors)

    # 5. Dual-write into Supabase pgvector (if configured)
    supabase_written = upsert_chunks_to_supabase(all_chunks, vectors)

    return IngestResponse(
        articles_fetched=len(articles),
        chunks_created=len(all_chunks),
        chunks_embedded=len(vectors),
        points_upserted=upserted,
        duplicates_skipped=duplicates,
    )


# ── POST /query ─────────────────────────────────────────────


@router.post("/query", response_model=QueryResponse)
def query_news(req: QueryRequest) -> QueryResponse:
    """
    Answer a news question using RAG:
    retrieve → rerank → generate.
    """
    # 1. Retrieve candidate chunks
    chunks = retrieve(
        query=req.question,
        top_k=settings.retrieve_top_k,
        source=req.source,
        category=req.category,
        days=req.days,
    )

    if not chunks:
        raise HTTPException(
            status_code=404,
            detail="No relevant news articles found. Try running /ingest first.",
        )

    # 2. Optionally rerank candidates, otherwise take the top chunks directly
    if settings.use_reranker:
        top_chunks = rerank(query=req.question, chunks=chunks, top_k=settings.generator_top_k)
    else:
        top_chunks = chunks[:settings.generator_top_k]

    # 3. Generate answer
    answer, sources = generate_answer(req.question, top_chunks)

    return QueryResponse(
        answer=answer,
        sources=sources,
        chunks_retrieved=len(chunks),
        chunks_after_rerank=len(top_chunks),
    )


# ── GET /health ─────────────────────────────────────────────


@router.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    """Check connectivity to Ollama and Qdrant."""
    # Ollama
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{settings.ollama_host}/api/tags")
            resp.raise_for_status()
        ollama = ServiceStatus(reachable=True, detail="OK")
    except Exception as exc:
        ollama = ServiceStatus(reachable=False, detail=str(exc))

    # Qdrant
    try:
        stats = collection_stats()
        qdrant = ServiceStatus(reachable=True, detail="OK")
    except Exception as exc:
        stats = {}
        qdrant = ServiceStatus(reachable=False, detail=str(exc))

    healthy = ollama.reachable and qdrant.reachable
    return HealthResponse(
        status="healthy" if healthy else "degraded",
        ollama=ollama,
        qdrant=qdrant,
        collection=stats,
    )
