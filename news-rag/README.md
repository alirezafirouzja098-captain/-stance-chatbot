# 📰 News RAG

A fully local **Retrieval-Augmented Generation** system for news articles, powered by **Ollama** and **Qdrant**.

## Architecture

```
RSS Feeds → feedparser → Clean → Chunk → Embed (nomic-embed-text)
                                              ↓
User Query → Embed → Qdrant Search → Rerank (CrossEncoder) → Generate (qwen3:8b)
                                                                    ↓
                                                              Cited Answer
```

## Prerequisites

- **Python 3.12+**
- **Ollama** running locally (`ollama serve`)
- **Qdrant** running locally (Docker recommended)
- **~6 GB** disk/VRAM for models

## Quick Start

### 1. Start Qdrant

```bash
docker run -d -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

### 2. Pull Ollama Models

```bash
ollama pull qwen3:8b
ollama pull nomic-embed-text
```

### 3. Install & Run

```bash
cd news-rag
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 4. Ingest News

```bash
curl -X POST http://localhost:8000/ingest
```

### 5. Ask a Question

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is happening in the global economy?"}'
```

## API Endpoints

| Method | Path      | Description                          |
|--------|-----------|--------------------------------------|
| POST   | `/ingest` | Fetch, clean, chunk, embed, & store  |
| POST   | `/query`  | Ask a question with RAG              |
| GET    | `/health` | Check Ollama & Qdrant connectivity   |

### POST /query — Request Body

```json
{
  "question": "What is the latest on AI regulation?",
  "source": "BBC News",
  "category": "technology",
  "days": 7
}
```

All filter fields (`source`, `category`, `days`) are optional.

### POST /query — Response

```json
{
  "answer": "According to recent reports [Source 1]...",
  "sources": [
    {
      "title": "EU passes landmark AI Act",
      "url": "https://...",
      "source": "BBC News",
      "published_date": "2024-01-15T12:00:00"
    }
  ],
  "chunks_retrieved": 20,
  "chunks_after_rerank": 5
}
```

## Docker Compose (Full Stack)

```bash
docker-compose up -d
```

This starts Ollama, Qdrant, and the News RAG app together.

## Configuration

All settings are controlled via environment variables or `.env`:

| Variable                  | Default               | Description                   |
|---------------------------|-----------------------|-------------------------------|
| `OLLAMA_HOST`             | `http://localhost:11434` | Ollama server URL          |
| `OLLAMA_CHAT_MODEL`       | `qwen3:8b`            | Chat model                    |
| `OLLAMA_EMBED_MODEL`      | `nomic-embed-text`    | Embedding model               |
| `QDRANT_HOST`             | `http://localhost:6333` | Qdrant server URL           |
| `QDRANT_COLLECTION`       | `news`                | Vector collection name        |
| `RSS_FEEDS`               | BBC, NYT, Reuters…    | Comma-separated RSS URLs      |
| `INGEST_INTERVAL_MINUTES` | `15`                  | Auto-ingest schedule          |
| `LOG_LEVEL`               | `INFO`                | Logging verbosity             |

## Running Tests

```bash
pytest tests/ -v
```

## Project Structure

```
news-rag/
├── main.py                 # FastAPI entry point
├── config/
│   ├── settings.py         # Pydantic settings
│   └── logging_config.py   # Structured logging
├── ingestion/
│   ├── models.py           # Article & ArticleChunk
│   ├── fetcher.py          # RSS feed parser
│   ├── cleaner.py          # HTML stripper
│   └── chunker.py          # Token-aware chunker
├── embeddings/
│   └── embedder.py         # Ollama embedding client
├── database/
│   └── qdrant_store.py     # Qdrant operations
├── retrieval/
│   └── retriever.py        # Query + filter + search
├── reranking/
│   └── reranker.py         # CrossEncoder reranker
├── api/
│   ├── schemas.py          # Pydantic API models
│   ├── generator.py        # LLM answer generation
│   └── routes.py           # API endpoints
├── tests/
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```
