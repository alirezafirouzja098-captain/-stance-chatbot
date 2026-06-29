"""Token-aware text chunking with overlap."""

from __future__ import annotations

import logging
import re

import tiktoken

from ingestion.models import Article, ArticleChunk

logger = logging.getLogger(__name__)

# Use cl100k_base — the same tokenizer behind modern OpenAI models
# and a good general-purpose byte-pair encoder.
_ENCODER = tiktoken.get_encoding("cl100k_base")

# ── Sentence splitting ──────────────────────────────────────

_SENTENCE_RE = re.compile(
    r"(?<=[.!?])\s+(?=[A-Z])"  # split after sentence-ending punctuation
)


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences (heuristic)."""
    return [s.strip() for s in _SENTENCE_RE.split(text) if s.strip()]


def _token_len(text: str) -> int:
    """Return the number of tokens in *text*."""
    return len(_ENCODER.encode(text))


# ── Public API ──────────────────────────────────────────────


def chunk_article(
    article: Article,
    cleaned_text: str,
    chunk_size: int = 400,
    overlap: int = 50,
    min_chunk_size: int = 50,
) -> list[ArticleChunk]:
    """
    Split *cleaned_text* into chunks of approximately *chunk_size* tokens,
    with *overlap* tokens of overlap between consecutive chunks.

    Each chunk carries the parent article's metadata.
    """
    sentences = _split_sentences(cleaned_text)
    if not sentences:
        return []

    chunks: list[ArticleChunk] = []
    current_sentences: list[str] = []
    current_tokens = 0
    chunk_index = 0

    for sentence in sentences:
        sent_tokens = _token_len(sentence)

        # If a single sentence exceeds chunk_size, emit it as its own chunk
        if sent_tokens > chunk_size:
            # Flush whatever we have so far
            if current_sentences:
                chunks.append(
                    _make_chunk(article, current_sentences, chunk_index)
                )
                chunk_index += 1
                current_sentences = []
                current_tokens = 0

            chunks.append(_make_chunk(article, [sentence], chunk_index))
            chunk_index += 1
            continue

        # Would adding this sentence exceed the target?
        if current_tokens + sent_tokens > chunk_size and current_sentences:
            chunks.append(
                _make_chunk(article, current_sentences, chunk_index)
            )
            chunk_index += 1

            # Keep the last few sentences as overlap
            overlap_sents: list[str] = []
            overlap_tokens = 0
            for s in reversed(current_sentences):
                s_tok = _token_len(s)
                if overlap_tokens + s_tok > overlap:
                    break
                overlap_sents.insert(0, s)
                overlap_tokens += s_tok

            current_sentences = overlap_sents
            current_tokens = overlap_tokens

        current_sentences.append(sentence)
        current_tokens += sent_tokens

    # Final chunk — always emit if we have no chunks yet (short text)
    if current_sentences and (current_tokens >= min_chunk_size or not chunks):
        chunks.append(_make_chunk(article, current_sentences, chunk_index))

    logger.debug(
        "Chunked '%s' into %d chunks (avg ~%d tokens)",
        article.title[:60],
        len(chunks),
        chunk_size,
    )
    return chunks


def _make_chunk(
    article: Article, sentences: list[str], index: int
) -> ArticleChunk:
    return ArticleChunk(
        text=" ".join(sentences),
        title=article.title,
        source=article.source,
        url=article.url,
        published_date=article.published_date,
        category=article.category,
        chunk_index=index,
    )
