"""Fetch and parse RSS feeds into Article objects."""

from __future__ import annotations

import logging
from datetime import datetime
from time import mktime

import feedparser

from ingestion.models import Article

logger = logging.getLogger(__name__)

# ── Source-name extraction helpers ──────────────────────────

_SOURCE_MAP: dict[str, str] = {
    "bbc": "BBC News",
    "nytimes": "New York Times",
    "reuters": "Reuters",
    "techcrunch": "TechCrunch",
    "cnn": "CNN",
    "aljazeera": "Al Jazeera",
}


def _guess_source(feed_url: str, feed_title: str | None) -> str:
    """Return a human-readable source name from the feed URL or title."""
    lower = feed_url.lower()
    for key, name in _SOURCE_MAP.items():
        if key in lower:
            return name
    return feed_title or "Unknown"


def _parse_date(entry: dict) -> datetime:
    """Extract a datetime from an RSS entry, with fallback to now()."""
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        return datetime.fromtimestamp(mktime(entry.published_parsed))
    if hasattr(entry, "updated_parsed") and entry.updated_parsed:
        return datetime.fromtimestamp(mktime(entry.updated_parsed))
    return datetime.now()


def _extract_category(entry: dict) -> str:
    """Pull the first tag / category from an RSS entry."""
    tags = entry.get("tags", [])
    if tags and isinstance(tags, list):
        term = tags[0].get("term", "general")
        return term.strip().lower() if term else "general"
    return "general"


def _extract_content(entry: dict) -> str:
    """Get the richest text content available in the entry."""
    # Prefer content blocks (full article text)
    if hasattr(entry, "content") and entry.content:
        return entry.content[0].get("value", "")
    # Fall back to summary / description
    return entry.get("summary", entry.get("description", ""))


# ── Public API ──────────────────────────────────────────────


def fetch_feeds(feed_urls: list[str]) -> list[Article]:
    """
    Fetch and parse all given RSS/Atom feed URLs.

    Returns a list of Article objects.  Duplicate URLs within
    a single fetch batch are silently dropped.
    """
    seen_urls: set[str] = set()
    articles: list[Article] = []

    for url in feed_urls:
        logger.info("Fetching feed: %s", url)
        try:
            feed = feedparser.parse(url)
        except Exception:
            logger.exception("Failed to parse feed %s", url)
            continue

        feed_title = feed.feed.get("title")
        source = _guess_source(url, feed_title)

        for entry in feed.entries:
            link = entry.get("link", "")
            if not link or link in seen_urls:
                continue
            seen_urls.add(link)

            content = _extract_content(entry)
            if not content:
                continue

            articles.append(
                Article(
                    title=entry.get("title", "Untitled"),
                    content=content,
                    source=source,
                    url=link,
                    published_date=_parse_date(entry),
                    category=_extract_category(entry),
                )
            )

        logger.info(
            "Parsed %d entries from %s (%s)",
            len(feed.entries),
            source,
            url,
        )

    logger.info("Total articles fetched: %d", len(articles))
    return articles
