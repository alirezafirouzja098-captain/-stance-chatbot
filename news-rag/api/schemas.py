"""Pydantic schemas for API request / response models."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Query ───────────────────────────────────────────────────


class QueryRequest(BaseModel):
    """Request body for the /query endpoint."""

    question: str = Field(..., min_length=1, description="The user's news question")
    source: str | None = Field(None, description="Filter by source (e.g. 'BBC News')")
    category: str | None = Field(None, description="Filter by category (e.g. 'technology')")
    days: int | None = Field(None, ge=1, description="Only use articles from the last N days")


class Source(BaseModel):
    """A single source citation."""

    title: str
    url: str
    source: str
    published_date: str


class QueryResponse(BaseModel):
    """Response from the /query endpoint."""

    answer: str
    sources: list[Source]
    chunks_retrieved: int
    chunks_after_rerank: int


# ── Ingest ──────────────────────────────────────────────────


class IngestResponse(BaseModel):
    """Response from the /ingest endpoint."""

    articles_fetched: int
    chunks_created: int
    chunks_embedded: int
    points_upserted: int
    duplicates_skipped: int


# ── Health ──────────────────────────────────────────────────


class ServiceStatus(BaseModel):
    """Status of a single dependency."""

    reachable: bool
    detail: str = ""


class HealthResponse(BaseModel):
    """Response from the /health endpoint."""

    status: str  # "healthy" | "degraded" | "unhealthy"
    ollama: ServiceStatus
    qdrant: ServiceStatus
    collection: dict = {}
