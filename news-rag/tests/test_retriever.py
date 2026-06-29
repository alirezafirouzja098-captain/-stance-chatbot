"""Tests for the retriever module — focused on filter construction logic."""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

from ingestion.models import RetrievedChunk


class TestRetrieverFilters:
    """Test that retriever correctly passes filters to the database layer."""

    @patch("retrieval.retriever.search_chunks")
    @patch("retrieval.retriever.embed_query")
    def test_no_filters(self, mock_embed, mock_search):
        from retrieval.retriever import retrieve

        mock_embed.return_value = [0.1] * 768
        mock_search.return_value = []

        retrieve("test query")

        mock_search.assert_called_once()
        _, kwargs = mock_search.call_args
        assert kwargs["source"] is None
        assert kwargs["category"] is None
        assert kwargs["date_from"] is None

    @patch("retrieval.retriever.search_chunks")
    @patch("retrieval.retriever.embed_query")
    def test_source_filter(self, mock_embed, mock_search):
        from retrieval.retriever import retrieve

        mock_embed.return_value = [0.1] * 768
        mock_search.return_value = []

        retrieve("test query", source="BBC News")

        _, kwargs = mock_search.call_args
        assert kwargs["source"] == "BBC News"

    @patch("retrieval.retriever.search_chunks")
    @patch("retrieval.retriever.embed_query")
    def test_category_filter(self, mock_embed, mock_search):
        from retrieval.retriever import retrieve

        mock_embed.return_value = [0.1] * 768
        mock_search.return_value = []

        retrieve("test query", category="technology")

        _, kwargs = mock_search.call_args
        assert kwargs["category"] == "technology"

    @patch("retrieval.retriever.search_chunks")
    @patch("retrieval.retriever.embed_query")
    def test_days_filter_sets_date_from(self, mock_embed, mock_search):
        from retrieval.retriever import retrieve

        mock_embed.return_value = [0.1] * 768
        mock_search.return_value = []

        retrieve("test query", days=7)

        _, kwargs = mock_search.call_args
        assert kwargs["date_from"] is not None
        # The date_from should be approximately 7 days ago
        cutoff = datetime.fromisoformat(kwargs["date_from"])
        expected = datetime.now() - timedelta(days=7)
        # Allow 5 seconds of drift
        assert abs((cutoff - expected).total_seconds()) < 5

    @patch("retrieval.retriever.search_chunks")
    @patch("retrieval.retriever.embed_query")
    def test_all_filters_combined(self, mock_embed, mock_search):
        from retrieval.retriever import retrieve

        mock_embed.return_value = [0.1] * 768
        mock_search.return_value = []

        retrieve(
            "test query",
            source="Reuters",
            category="finance",
            days=3,
        )

        _, kwargs = mock_search.call_args
        assert kwargs["source"] == "Reuters"
        assert kwargs["category"] == "finance"
        assert kwargs["date_from"] is not None

    @patch("retrieval.retriever.search_chunks")
    @patch("retrieval.retriever.embed_query")
    def test_custom_top_k(self, mock_embed, mock_search):
        from retrieval.retriever import retrieve

        mock_embed.return_value = [0.1] * 768
        mock_search.return_value = []

        retrieve("test query", top_k=10)

        _, kwargs = mock_search.call_args
        assert kwargs["top_k"] == 10
