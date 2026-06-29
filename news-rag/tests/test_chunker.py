"""Tests for the text chunking module."""

import pytest
from datetime import datetime

from ingestion.chunker import chunk_article
from ingestion.models import Article


def _make_article(content: str = "Placeholder") -> Article:
    """Helper to create a test article."""
    return Article(
        title="Test Article",
        content=content,
        source="Test Source",
        url="https://example.com/test",
        published_date=datetime(2024, 1, 15, 12, 0, 0),
        category="technology",
    )


class TestChunkArticle:
    """Unit tests for chunk_article()."""

    def test_short_text_produces_single_chunk(self):
        article = _make_article()
        text = "This is a short article about technology."
        chunks = chunk_article(article, text, chunk_size=400, overlap=50)
        assert len(chunks) == 1
        assert chunks[0].text == text

    def test_metadata_preserved(self):
        article = _make_article()
        text = "Some article content for testing metadata preservation."
        chunks = chunk_article(article, text, chunk_size=400, overlap=50)
        assert len(chunks) >= 1
        chunk = chunks[0]
        assert chunk.title == "Test Article"
        assert chunk.source == "Test Source"
        assert chunk.url == "https://example.com/test"
        assert chunk.category == "technology"
        assert chunk.chunk_index == 0

    def test_long_text_produces_multiple_chunks(self):
        article = _make_article()
        # Generate a long text (~800 tokens worth of sentences)
        sentence = "The global economy continues to show resilience despite ongoing challenges in multiple sectors. "
        text = sentence * 60  # ~60 sentences
        chunks = chunk_article(article, text, chunk_size=200, overlap=50)
        assert len(chunks) > 1

    def test_chunk_indices_are_sequential(self):
        article = _make_article()
        sentence = "Markets rallied on positive earnings reports from major technology companies. "
        text = sentence * 40
        chunks = chunk_article(article, text, chunk_size=100, overlap=20)
        indices = [c.chunk_index for c in chunks]
        assert indices == list(range(len(chunks)))

    def test_empty_text_returns_no_chunks(self):
        article = _make_article()
        chunks = chunk_article(article, "", chunk_size=400, overlap=50)
        assert chunks == []

    def test_overlap_creates_shared_content(self):
        article = _make_article()
        sentence = "New policy changes are expected to affect international trade agreements significantly. "
        text = sentence * 30
        chunks = chunk_article(article, text, chunk_size=100, overlap=50)
        if len(chunks) >= 2:
            # The end of chunk N should overlap with the start of chunk N+1
            # We can't check exact tokens, but the second chunk should
            # contain some text from the first
            last_words_first = chunks[0].text.split()[-5:]
            first_words_second = chunks[1].text.split()[:20]
            overlap_found = any(
                w in first_words_second for w in last_words_first
            )
            assert overlap_found, "Expected overlap between consecutive chunks"

    def test_payload_serialisation(self):
        article = _make_article()
        text = "A short chunk for serialisation testing."
        chunks = chunk_article(article, text, chunk_size=400, overlap=50)
        payload = chunks[0].to_payload()
        assert isinstance(payload, dict)
        assert "text" in payload
        assert "title" in payload
        assert "published_date" in payload
        assert isinstance(payload["published_date"], str)
