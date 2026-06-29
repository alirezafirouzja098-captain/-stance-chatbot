"""Tests for the API Pydantic schemas."""

import pytest
from pydantic import ValidationError

from api.schemas import (
    HealthResponse,
    IngestResponse,
    QueryRequest,
    QueryResponse,
    ServiceStatus,
    Source,
)


class TestQueryRequest:
    """Validation tests for QueryRequest."""

    def test_valid_minimal(self):
        req = QueryRequest(question="What happened today?")
        assert req.question == "What happened today?"
        assert req.source is None
        assert req.category is None
        assert req.days is None

    def test_valid_full(self):
        req = QueryRequest(
            question="Latest tech news",
            source="BBC News",
            category="technology",
            days=7,
        )
        assert req.days == 7

    def test_empty_question_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(question="")

    def test_negative_days_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(question="test", days=0)

    def test_zero_days_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(question="test", days=0)


class TestQueryResponse:
    """Tests for QueryResponse."""

    def test_round_trip(self):
        resp = QueryResponse(
            answer="The market rose 2%.",
            sources=[
                Source(
                    title="Markets up",
                    url="https://example.com/1",
                    source="Reuters",
                    published_date="2024-01-15T12:00:00",
                )
            ],
            chunks_retrieved=20,
            chunks_after_rerank=5,
        )
        data = resp.model_dump()
        assert data["chunks_retrieved"] == 20
        assert len(data["sources"]) == 1


class TestIngestResponse:
    """Tests for IngestResponse."""

    def test_all_fields(self):
        resp = IngestResponse(
            articles_fetched=50,
            chunks_created=120,
            chunks_embedded=120,
            points_upserted=120,
            duplicates_skipped=10,
        )
        assert resp.duplicates_skipped == 10


class TestHealthResponse:
    """Tests for HealthResponse."""

    def test_healthy(self):
        resp = HealthResponse(
            status="healthy",
            ollama=ServiceStatus(reachable=True, detail="OK"),
            qdrant=ServiceStatus(reachable=True, detail="OK"),
            collection={"points_count": 500},
        )
        assert resp.status == "healthy"
