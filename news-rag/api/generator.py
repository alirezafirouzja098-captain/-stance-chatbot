"""Generate answers using Ollama's chat API with retrieved context."""

from __future__ import annotations

import logging

import httpx

from api.schemas import Source
from config.settings import settings
from ingestion.models import RetrievedChunk

logger = logging.getLogger(__name__)

# ── System prompt ───────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a professional news analyst. Your role is to answer the user's \
question using ONLY the provided news excerpts below.

Rules:
1. Base your answer strictly on the provided context. Do NOT fabricate information.
2. Be extremely concise. Deliver your response in a single, direct paragraph of 3-4 sentences (maximum 120 words).
3. Cite your sources by referring to [Source N] tags inline.
4. If the context does not contain enough information, say so clearly.
"""


def _build_context(chunks: list[RetrievedChunk]) -> str:
    """Format retrieved chunks into a numbered context block."""
    parts: list[str] = []
    for i, chunk in enumerate(chunks, 1):
        parts.append(
            f"[Source {i}] ({chunk.source} — {chunk.published_date})\n"
            f"Title: {chunk.title}\n"
            f"{chunk.text}\n"
        )
    return "\n---\n".join(parts)


def _extract_sources(chunks: list[RetrievedChunk]) -> list[Source]:
    """De-duplicate and return source citations."""
    seen: set[str] = set()
    sources: list[Source] = []
    for chunk in chunks:
        if chunk.url in seen:
            continue
        seen.add(chunk.url)
        sources.append(
            Source(
                title=chunk.title,
                url=chunk.url,
                source=chunk.source,
                published_date=chunk.published_date,
            )
        )
    return sources


# ── Public API ──────────────────────────────────────────────


def generate_answer(
    question: str,
    context_chunks: list[RetrievedChunk],
) -> tuple[str, list[Source]]:
    """
    Generate a cited answer using Ollama's chat completion.

    Args:
        question: The user's question.
        context_chunks: Top-k chunks from retrieval + reranking.

    Returns:
        A tuple of (answer_text, source_citations).
    """
    context = _build_context(context_chunks)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"## Context\n{context}\n\n"
                f"## Question\n{question}"
            ),
        },
    ]

    url = f"{settings.ollama_host}/api/chat"
    payload = {
        "model": settings.ollama_chat_model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": settings.num_predict,
        },
    }

    logger.info("Generating answer with %s …", settings.ollama_chat_model)

    with httpx.Client(timeout=180.0) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    answer = data.get("message", {}).get("content", "")

    # Strip <think>…</think> blocks that qwen3 may emit
    import re
    answer = re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL).strip()

    sources = _extract_sources(context_chunks)

    logger.info("Answer generated (%d chars, %d sources)", len(answer), len(sources))
    return answer, sources
