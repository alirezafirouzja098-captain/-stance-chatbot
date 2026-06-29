"""Data models for news articles and chunks."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Article:
    """A single news article parsed from an RSS feed."""

    title: str
    content: str
    source: str
    url: str
    published_date: datetime
    category: str = "general"

    def __post_init__(self) -> None:
        if isinstance(self.published_date, str):
            # Try common RSS date formats
            for fmt in (
                "%a, %d %b %Y %H:%M:%S %z",
                "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%d %H:%M:%S",
            ):
                try:
                    self.published_date = datetime.strptime(self.published_date, fmt)
                    return
                except ValueError:
                    continue
            # Fallback: use current time if parsing fails
            self.published_date = datetime.now()


@dataclass
class ArticleChunk:
    """A chunk of text derived from an article, ready for embedding."""

    text: str
    title: str
    source: str
    url: str
    published_date: datetime
    category: str
    chunk_index: int

    def to_payload(self) -> dict:
        """Convert to a Qdrant-compatible payload dictionary."""
        return {
            "text": self.text,
            "title": self.title,
            "source": self.source,
            "url": self.url,
            "published_date": self.published_date.isoformat(),
            "category": self.category,
            "chunk_index": self.chunk_index,
        }


@dataclass
class RetrievedChunk:
    """A chunk retrieved from vector search, with relevance score."""

    text: str
    title: str
    source: str
    url: str
    published_date: str
    category: str
    score: float = 0.0
