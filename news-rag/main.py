"""News RAG — FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router, ingest_feeds
from config.logging_config import setup_logging
from config.settings import settings
from database.qdrant_store import init_collection

logger = logging.getLogger(__name__)


# ── Lifespan ────────────────────────────────────────────────

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hooks."""
    # ── Startup ─────────────────────────────────────────────
    setup_logging()
    logger.info("Starting News RAG service …")

    # Ensure Qdrant collection exists
    init_collection()

    # Schedule periodic ingestion
    scheduler.add_job(
        ingest_feeds,
        "interval",
        minutes=settings.ingest_interval_minutes,
        id="scheduled_ingest",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "Scheduled ingestion every %d minutes",
        settings.ingest_interval_minutes,
    )

    yield

    # ── Shutdown ────────────────────────────────────────────
    scheduler.shutdown(wait=False)
    logger.info("News RAG service stopped")


# ── App ─────────────────────────────────────────────────────

app = FastAPI(
    title="News RAG",
    description="Local News Retrieval-Augmented Generation system powered by Ollama & Qdrant",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the stance-chatbot frontend and any localhost dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
