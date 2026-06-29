import sys
import os
import logging

# Ensure project root is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config.logging_config import setup_logging
from database.qdrant_store import init_collection, collection_stats, get_client
from api.routes import ingest_feeds
from retrieval.retriever import retrieve
from reranking.reranker import rerank
from api.generator import generate_answer
from api.schemas import QueryRequest
from api.routes import query_news

def run_smoke_test():
    setup_logging()
    logger = logging.getLogger("smoke_test")
    logger.setLevel(logging.INFO)
    
    logger.info("=== STEP 1: INITIALIZE COLLECTION ===")
    init_collection()
    
    logger.info("=== STEP 2: COLLECTION STATS BEFORE INGEST ===")
    stats = collection_stats()
    logger.info("Stats: %s", stats)
    
    logger.info("=== STEP 3: RUN INGESTION (FETCH RSS -> CLEAN -> CHUNK -> EMBED -> QDRANT) ===")
    ingest_result = ingest_feeds()
    logger.info("Ingest result: %s", ingest_result.model_dump())
    
    logger.info("=== STEP 4: COLLECTION STATS AFTER INGEST ===")
    stats = collection_stats()
    logger.info("Stats: %s", stats)
    
    # Check if we have any points
    points_count = stats.get("points_count", 0)
    if points_count == 0:
        logger.error("No points indexed! Cannot query.")
        return
        
    logger.info("=== STEP 5: RUN RAG QUERY ===")
    # Pick a generic query that matches standard world/tech news topics
    question = "What are the latest developments in technology, science, or world news?"
    logger.info("Question: %s", question)
    
    req = QueryRequest(question=question)
    try:
        response = query_news(req)
        logger.info("=== RAG RESPONSE ===")
        logger.info("Answer:\n%s", response.answer)
        logger.info("\nSources:")
        for idx, src in enumerate(response.sources, 1):
            logger.info("[%d] %s (%s) - %s", idx, src.title, src.source, src.url)
    except Exception as exc:
        logger.exception("RAG Query failed")

if __name__ == "__main__":
    run_smoke_test()
