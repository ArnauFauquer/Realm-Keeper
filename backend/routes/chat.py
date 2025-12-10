"""
Chat routes for Realm Keeper
Provides endpoints for RAG-based chat functionality
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import asyncio
import inspect

from services.lightrag_service import LightRAGService, get_lightrag_service
from config.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    """A single chat message"""
    role: str = Field(..., description="Role of the message sender (user/assistant)")
    content: str = Field(..., description="Content of the message")


class ChatRequest(BaseModel):
    """Request model for chat endpoint"""
    message: str = Field(..., description="The user's message/question")
    mode: str = Field(
        default="hybrid",
        description="Query mode: naive, local, global, hybrid, or mix"
    )
    stream: bool = Field(default=False, description="Whether to stream the response")
    conversation_history: Optional[List[ChatMessage]] = Field(
        default=None,
        description="Previous conversation messages for context"
    )


class ChatResponse(BaseModel):
    """Response model for chat endpoint"""
    response: str = Field(..., description="The assistant's response")
    mode: str = Field(..., description="The query mode used")


class IndexRequest(BaseModel):
    """Request model for indexing endpoint"""
    force_reindex: bool = Field(
        default=False,
        description="Whether to force reindexing of all documents"
    )


class IndexResponse(BaseModel):
    """Response model for indexing endpoint"""
    status: str
    indexed_files: Optional[int] = None
    total_files: Optional[int] = None
    errors: Optional[List[str]] = None
    message: Optional[str] = None


class DeleteIndexResponse(BaseModel):
    """Response model for delete index endpoint"""
    status: str
    message: str
    deleted_files: Optional[List[str]] = None


class StatusResponse(BaseModel):
    """Response model for status endpoint"""
    initialized: bool
    indexing: bool
    working_dir: str
    ollama_host: str
    llm_model: str
    embedding_model: str
    # Progress fields (only present when indexing)
    indexing_progress: Optional[int] = None
    indexing_total: Optional[int] = None
    indexing_current_file: Optional[str] = None
    indexing_percent: Optional[float] = None


@router.get("/status", response_model=StatusResponse)
async def get_status(
    service: LightRAGService = Depends(get_lightrag_service)
) -> StatusResponse:
    """Get the current status of the LightRAG service"""
    status = await service.get_status()
    return StatusResponse(**status)


@router.post("/index", response_model=IndexResponse)
async def index_vault(
    request: IndexRequest = IndexRequest(),
    service: LightRAGService = Depends(get_lightrag_service)
) -> IndexResponse:
    """
    Index all markdown files from the vault into LightRAG.
    This creates the knowledge graph for RAG queries.
    Returns immediately and runs indexing in the background.
    Poll /chat/status to check progress.
    """
    # Check if already indexing
    if service.is_indexing():
        return IndexResponse(status="in_progress", message="Indexing already in progress")
    
    # Start indexing in background task
    asyncio.create_task(service.index_vault(force_reindex=request.force_reindex))
    
    return IndexResponse(status="started", message="Indexing started in background. Poll /chat/status for progress.")


@router.delete("/index", response_model=DeleteIndexResponse)
async def delete_index(
    service: LightRAGService = Depends(get_lightrag_service)
) -> DeleteIndexResponse:
    """
    Delete all indexed data from LightRAG.
    This removes the knowledge graph and all embeddings.
    Use this to start fresh or free up storage.
    """
    result = await service.delete_index()
    return DeleteIndexResponse(**result)


@router.post("/query", response_model=ChatResponse)
async def chat_query(
    request: ChatRequest,
    service: LightRAGService = Depends(get_lightrag_service)
) -> ChatResponse:
    """
    Query the LightRAG knowledge base with a question.
    
    Query modes:
    - **naive**: Basic search without advanced techniques
    - **local**: Focuses on context-dependent information
    - **global**: Utilizes global knowledge from the graph
    - **hybrid**: Combines local and global retrieval methods
    - **mix**: Integrates knowledge graph and vector retrieval
    """
    # Convert conversation history to the expected format
    history = None
    if request.conversation_history:
        history = [
            {"role": msg.role, "content": msg.content}
            for msg in request.conversation_history
        ]
    
    try:
        response = await service.query(
            question=request.message,
            mode=request.mode,
            stream=False,
            conversation_history=history,
        )
        
        return ChatResponse(response=response, mode=request.mode)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.post("/query/stream")
async def chat_query_stream(
    request: ChatRequest,
    service: LightRAGService = Depends(get_lightrag_service)
):
    """
    Query the LightRAG knowledge base with streaming response.
    Returns a Server-Sent Events stream with safety limits:
    - 5 minute timeout for the complete response
    - Maximum 10000 chunks (~10MB of text)
    - Comprehensive error handling
    """
    # Convert conversation history to the expected format
    history = None
    if request.conversation_history:
        history = [
            {"role": msg.role, "content": msg.content}
            for msg in request.conversation_history
        ]
    
    async def generate():
        try:
            # Timeout de 5 minutos para la respuesta completa
            async with asyncio.timeout(300):
                response = await service.query(
                    question=request.message,
                    mode=request.mode,
                    stream=True,
                    conversation_history=history,
                )
                
                chunk_count = 0
                max_chunks = 10000  # ~10MB de tokens
                
                # Check if response is an async generator
                if inspect.isasyncgen(response):
                    async for chunk in response:
                        if chunk_count >= max_chunks:
                            logger.warning(f"Query stream exceeded max chunks ({max_chunks})")
                            yield "data: [MAX_LENGTH_EXCEEDED]\n\n"
                            break
                        
                        yield f"data: {chunk}\n\n"
                        chunk_count += 1
                else:
                    # If not streaming, yield the whole response
                    yield f"data: {response}\n\n"
                
                logger.info(f"Query stream completed: {chunk_count} chunks, mode={request.mode}")
                yield "data: [DONE]\n\n"
        
        except asyncio.TimeoutError:
            logger.error("Query stream timeout: exceeded 5 minute limit")
            yield "data: [TIMEOUT: Query took more than 5 minutes]\n\n"
        except Exception as e:
            logger.error(f"Stream error: {str(e)}", exc_info=True)
            # Send truncated error message (first 200 chars)
            error_msg = str(e)[:200]
            yield f"data: [ERROR: {error_msg}]\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/initialize")
async def initialize_service(
    service: LightRAGService = Depends(get_lightrag_service)
) -> dict:
    """
    Explicitly initialize the LightRAG service.
    Usually called automatically on first use.
    """
    if service.is_initialized():
        return {"status": "already_initialized"}
    
    await service.initialize()
    return {"status": "initialized"}
