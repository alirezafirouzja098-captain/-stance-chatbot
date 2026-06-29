"""HTML cleaning and text normalisation utilities."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup


# Tags whose entire subtree should be removed (they never contain article text)
_STRIP_TAGS = {
    "script", "style", "nav", "header", "footer",
    "aside", "form", "noscript", "iframe", "svg",
}

# Patterns that commonly appear in boilerplate / ad text
_BOILERPLATE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"(cookie|privacy)\s+policy", re.IGNORECASE),
    re.compile(r"subscribe\s+(now|to|for)", re.IGNORECASE),
    re.compile(r"sign\s+up\s+for\s+(our|the)\s+newsletter", re.IGNORECASE),
    re.compile(r"advertisement", re.IGNORECASE),
    re.compile(r"©\s*\d{4}", re.IGNORECASE),
    re.compile(r"all\s+rights\s+reserved", re.IGNORECASE),
]


def clean_html(raw: str) -> str:
    """
    Strip HTML tags, scripts, styles, and boilerplate from *raw* text.

    Returns plain, normalised text suitable for chunking.
    """
    if not raw:
        return ""

    soup = BeautifulSoup(raw, "html.parser")

    # Remove unwanted element subtrees
    for tag_name in _STRIP_TAGS:
        for tag in soup.find_all(tag_name):
            tag.decompose()

    text = soup.get_text(separator="\n")

    # Remove boilerplate sentences
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if any(pat.search(stripped) for pat in _BOILERPLATE_PATTERNS):
            continue
        lines.append(stripped)

    text = " ".join(lines)

    # Collapse multiple spaces / tabs into one
    text = re.sub(r"[ \t]+", " ", text)
    # Collapse multiple newlines
    text = re.sub(r"\n{2,}", "\n", text)

    return text.strip()
