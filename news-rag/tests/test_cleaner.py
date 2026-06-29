"""Tests for the HTML cleaner module."""

import pytest

from ingestion.cleaner import clean_html


class TestCleanHtml:
    """Unit tests for clean_html()."""

    def test_strips_html_tags(self):
        raw = "<p>Hello <b>world</b></p>"
        assert clean_html(raw) == "Hello world"

    def test_removes_script_tags(self):
        raw = "<p>Text</p><script>alert('xss')</script><p>More</p>"
        result = clean_html(raw)
        assert "alert" not in result
        assert "Text" in result
        assert "More" in result

    def test_removes_style_tags(self):
        raw = "<style>.red{color:red}</style><p>Visible</p>"
        result = clean_html(raw)
        assert "red" not in result
        assert "Visible" in result

    def test_removes_nav_and_footer(self):
        raw = (
            "<nav><a href='/'>Home</a></nav>"
            "<article>News content here</article>"
            "<footer>Copyright 2024</footer>"
        )
        result = clean_html(raw)
        assert "News content here" in result
        assert "Home" not in result

    def test_removes_boilerplate_patterns(self):
        raw = (
            "<p>The economy grew 3% this quarter.</p>"
            "<p>Subscribe now to our newsletter for updates.</p>"
            "<p>© 2024 All rights reserved.</p>"
        )
        result = clean_html(raw)
        assert "economy grew" in result
        assert "Subscribe" not in result
        assert "rights reserved" not in result

    def test_normalises_whitespace(self):
        raw = "<p>Word1    Word2\t\tWord3</p>"
        result = clean_html(raw)
        assert "Word1 Word2 Word3" == result

    def test_empty_input(self):
        assert clean_html("") == ""
        assert clean_html(None) == ""

    def test_plain_text_passthrough(self):
        text = "Just plain text with no HTML."
        assert clean_html(text) == text
