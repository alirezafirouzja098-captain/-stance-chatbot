"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration for the News RAG application."""

    # ── Ollama ──────────────────────────────────────────────
    ollama_host: str = "http://localhost:11434"
    ollama_chat_model: str = "llama3.2:1b"
    ollama_embed_model: str = "nomic-embed-text"
    num_predict: int = 256

    # ── Supabase (optional dual-write) ─────────────────────
    supabase_url: str = ""
    supabase_service_key: str = ""

    # ── Qdrant ──────────────────────────────────────────────
    qdrant_host: str = "http://localhost:6333"
    qdrant_collection: str = "news"
    retrieve_top_k: int = 8
    generator_top_k: int = 3
    use_reranker: bool = True

    # ── RSS Feeds ───────────────────────────────────────────
    rss_feeds: str = (
        "https://feeds.bbci.co.uk/news/world/rss.xml,"
        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml,"
        "https://feeds.reuters.com/reuters/topNews,"
        "https://feeds.feedburner.com/TechCrunch,"
        "https://rss.cnn.com/rss/edition_world.rss,"
        "https://www.aljazeera.com/xml/rss/all.xml"
    )

    # ── Scheduler ───────────────────────────────────────────
    ingest_interval_minutes: int = 15

    # ── Logging ─────────────────────────────────────────────
    log_level: str = "INFO"

    # ── Derived ─────────────────────────────────────────────
    @property
    def feed_urls(self) -> list[str]:
        """Parse the comma-separated RSS_FEEDS string into a list."""
        return [url.strip() for url in self.rss_feeds.split(",") if url.strip()]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
