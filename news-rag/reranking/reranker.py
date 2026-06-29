"""Re-rank retrieved chunks using a cross-encoder model."""

from __future__ import annotations

import logging

from sentence_transformers import CrossEncoder

from ingestion.models import RetrievedChunk

logger = logging.getLogger(__name__)

# ── Lazy-loaded model singleton ─────────────────────────────

_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_model: CrossEncoder | None = None


def _get_model() -> CrossEncoder:
    """Load the cross-encoder model on first use."""
    global _model
    if _model is None:
        logger.info("Loading reranker model '%s' …", _MODEL_NAME)
        _model = CrossEncoder(_MODEL_NAME)
        logger.info("Reranker model loaded")
    return _model


# ── Public API ──────────────────────────────────────────────


def rerank(
    query: str,
    chunks: list[RetrievedChunk],
    top_k: int = 5,
) -> list[RetrievedChunk]:
    """
    Re-rank *chunks* by cross-encoder relevance to *query*.

    The cross-encoder scores each (query, chunk) pair jointly,
    producing much more accurate relevance estimates than
    bi-encoder cosine similarity alone.

    Args:
        query: The user's question.
        chunks: Candidate chunks from the vector search stage.
        top_k: Number of chunks to return after re-ranking.

    Returns:
        The top-k chunks sorted by cross-encoder score (descending).
    """
    if not chunks:
        return []

    model = _get_model()

    # Build (query, document) pairs
    pairs = [[query, chunk.text] for chunk in chunks]

    # Score all pairs
    scores = model.predict(pairs, batch_size=32)

    # Pair each chunk with its reranker score
    scored = list(zip(chunks, scores))
    scored.sort(key=lambda x: float(x[1]), reverse=True)

    reranked = []
    for chunk, score in scored[:top_k]:
        # Update the chunk score to reflect the reranker's output
        chunk.score = float(score)
        reranked.append(chunk)

    logger.info(
        "Reranked %d -> %d chunks (top score: %.4f)",
        len(chunks),
        len(reranked),
        reranked[0].score if reranked else 0.0,
    )
    return reranked
