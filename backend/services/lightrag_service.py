"""
LightRAG Service for Realm Keeper
Provides RAG-based chat functionality for the vault notes
"""
import asyncio
import logging
from typing import Optional, AsyncGenerator
import numpy as np

from lightrag import LightRAG, QueryParam
from lightrag.llm.ollama import ollama_model_complete, ollama_embed
from lightrag.utils import EmbeddingFunc
from lightrag.kg.shared_storage import initialize_pipeline_status

from config.settings import settings

logger = logging.getLogger("lightrag")


class LightRAGService:
    """
    Service class to manage LightRAG instance and operations
    """
    
    _instance: Optional["LightRAGService"] = None
    _rag: Optional[LightRAG] = None
    _initialized: bool = False
    _indexing: bool = False
    _indexing_progress: int = 0
    _indexing_total: int = 0
    _indexing_current_file: str = ""
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    async def initialize(self) -> None:
        """Initialize the LightRAG instance"""
        if self._initialized:
            return
        
        # Ensure working directory exists
        settings.LIGHTRAG_WORKING_DIR.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Initializing LightRAG with Ollama at {settings.OLLAMA_HOST}")
        logger.info(f"LLM Model: {settings.LLM_MODEL}, Embedding Model: {settings.EMBEDDING_MODEL}")
        
        self._rag = LightRAG(
            working_dir=str(settings.LIGHTRAG_WORKING_DIR),
            llm_model_func=ollama_model_complete,
            llm_model_name=settings.LLM_MODEL,
            llm_model_kwargs={
                "host": settings.OLLAMA_HOST,
                "options": {"num_ctx": settings.LLM_CONTEXT_SIZE},
                "timeout": settings.LLM_TIMEOUT,
            },
            # Increase LightRAG's internal timeout for LLM worker pool
            llm_model_max_async=2,  # Reduce parallelism to avoid overloading Ollama
            # Larger chunks for better context in small markdown files
            chunk_token_size=3000,  # Increased from default ~1200
            chunk_overlap_token_size=300,  # 10% overlap for context continuity
            embedding_func=EmbeddingFunc(
                embedding_dim=settings.EMBEDDING_DIM,
                max_token_size=8192,
                func=lambda texts: ollama_embed(
                    texts,
                    embed_model=settings.EMBEDDING_MODEL,
                    host=settings.OLLAMA_HOST,
                    timeout=settings.EMBED_TIMEOUT,
                ),
            ),
            embedding_batch_num=4,  # Reduce batch size
        )
        
        await self._rag.initialize_storages()
        await initialize_pipeline_status()
        self._initialized = True
        logger.info("LightRAG initialized successfully")
    
    async def finalize(self) -> None:
        """Clean up LightRAG resources"""
        if self._rag:
            await self._rag.finalize_storages()
            self._initialized = False
            logger.info("LightRAG finalized")
    
    def is_initialized(self) -> bool:
        """Check if LightRAG is initialized"""
        return self._initialized
    
    def is_indexing(self) -> bool:
        """Check if indexing is in progress"""
        return self._indexing
    
    async def index_vault(self, force_reindex: bool = False) -> dict:
        """
        Index all markdown files from the vault into LightRAG
        
        Args:
            force_reindex: If True, clear existing data and reindex everything
        
        Returns:
            Dictionary with indexing status and stats
        """
        if not self._initialized:
            await self.initialize()
        
        if self._indexing:
            return {"status": "error", "message": "Indexing already in progress"}
        
        self._indexing = True
        self._indexing_progress = 0
        self._indexing_current_file = ""
        vault_path = settings.VAULT_PATH
        
        try:
            # Get all markdown files
            md_files = list(vault_path.rglob("*.md"))
            # Filter out templates early
            md_files = [f for f in md_files if "templates" not in str(f)]
            self._indexing_total = len(md_files)
            logger.info(f"Found {len(md_files)} markdown files to index")
            
            indexed_count = 0
            errors = []
            
            for idx, md_file in enumerate(md_files):
                try:
                    # Update progress
                    self._indexing_progress = idx + 1
                    relative_path = md_file.relative_to(vault_path)
                    self._indexing_current_file = str(relative_path)
                    
                    # Read file content
                    content = md_file.read_text(encoding="utf-8")
                    
                    # Skip empty files
                    if not content.strip():
                        continue
                    
                    # Create a document with metadata
                    doc_content = f"# Source: {relative_path}\n\n{content}"
                    
                    # Insert into LightRAG
                    await self._rag.ainsert(doc_content)
                    indexed_count += 1
                    
                    logger.debug(f"Indexed: {relative_path}")
                    
                except Exception as e:
                    error_msg = f"Error indexing {md_file}: {str(e)}"
                    logger.error(error_msg)
                    errors.append(error_msg)
            
            return {
                "status": "success",
                "indexed_files": indexed_count,
                "total_files": len(md_files),
                "errors": errors if errors else None,
            }
            
        except Exception as e:
            logger.error(f"Indexing failed: {str(e)}")
            return {"status": "error", "message": str(e)}
        
        finally:
            self._indexing = False
            self._indexing_progress = 0
            self._indexing_total = 0
            self._indexing_current_file = ""
    
    async def query(
        self,
        question: str,
        mode: str = "hybrid",
        stream: bool = False,
        conversation_history: Optional[list] = None,
    ) -> str | AsyncGenerator[str, None]:
        """
        Query the LightRAG knowledge base with custom prompt handling
        
        Args:
            question: The question to ask
            mode: Query mode - "naive", "local", "global", "hybrid", or "mix"
            stream: Whether to stream the response
            conversation_history: Optional list of previous messages
        
        Returns:
            The response from LightRAG (string or async generator if streaming)
        """
        if not self._initialized:
            await self.initialize()
        
        valid_modes = ["naive", "local", "global", "hybrid", "mix"]
        if mode not in valid_modes:
            mode = "hybrid"
        
        # First, get just the context (no LLM call)
        context_param = QueryParam(
            mode=mode,
            only_need_context=True,
            enable_rerank=False,
            top_k=60,
            chunk_top_k=30,
        )
        
        logger.info(f"Querying LightRAG - Mode: {mode}, Question: {question[:100]}...")
        
        # Get the context
        context = await self._rag.aquery(question, param=context_param)
        
        # Build our own simple prompt that small models can follow
        simple_prompt = f"""Based on the following context from the vault, answer the question.
If the answer is in the context, provide it. If not, say "I couldn't find that information in the vault."

CONTEXT:
{context}

QUESTION: {question}

ANSWER (based only on the context above):"""
        
        # Call Ollama directly with httpx
        import httpx
        
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                f"{settings.OLLAMA_HOST}/api/generate",
                json={
                    "model": settings.LLM_MODEL,
                    "prompt": simple_prompt,
                    "system": "You are a helpful assistant that answers questions ONLY based on the provided context. Never make up information.",
                    "stream": False,
                    "options": {"num_ctx": settings.LLM_CONTEXT_SIZE}
                }
            )
            result = response.json()
            return result.get("response", "Error generating response")
    
    async def get_status(self) -> dict:
        """Get the current status of LightRAG service"""
        status = {
            "initialized": self._initialized,
            "indexing": self._indexing,
            "working_dir": str(settings.LIGHTRAG_WORKING_DIR),
            "ollama_host": settings.OLLAMA_HOST,
            "llm_model": settings.LLM_MODEL,
            "embedding_model": settings.EMBEDDING_MODEL,
        }
        
        # Add progress info if indexing
        if self._indexing:
            status["indexing_progress"] = self._indexing_progress
            status["indexing_total"] = self._indexing_total
            status["indexing_current_file"] = self._indexing_current_file
            if self._indexing_total > 0:
                status["indexing_percent"] = round((self._indexing_progress / self._indexing_total) * 100, 1)
            else:
                status["indexing_percent"] = 0
        
        return status
    
    async def delete_index(self) -> dict:
        """
        Delete all indexed data from LightRAG storage.
        This removes the knowledge graph and all embeddings.
        
        Returns:
            Dictionary with deletion status
        """
        if self._indexing:
            return {"status": "error", "message": "Cannot delete while indexing is in progress"}
        
        try:
            # Finalize current instance if initialized
            if self._initialized:
                await self.finalize()
            
            # Reset the RAG instance completely
            self._rag = None
            self._initialized = False
            
            # Files to delete in the working directory
            files_to_delete = [
                "graph_chunk_entity_relation.graphml",
                "kv_store_doc_status.json",
                "kv_store_full_docs.json",
                "kv_store_text_chunks.json",
                "kv_store_full_entities.json",
                "kv_store_full_relations.json",
                "kv_store_entity_chunks.json",
                "kv_store_relation_chunks.json",
                "kv_store_llm_response_cache.json",
                "vdb_chunks.json",
                "vdb_entities.json",
                "vdb_relationships.json",
            ]
            
            deleted_files = []
            working_path = settings.LIGHTRAG_WORKING_DIR
            
            for filename in files_to_delete:
                file_path = working_path / filename
                if file_path.exists():
                    file_path.unlink()
                    deleted_files.append(filename)
                    logger.info(f"Deleted: {filename}")
            
            # Reinitialize LightRAG with fresh storage
            await self.initialize()
            
            return {
                "status": "success",
                "message": f"Deleted {len(deleted_files)} index files",
                "deleted_files": deleted_files
            }
            
        except Exception as e:
            logger.error(f"Error deleting index: {str(e)}")
            return {"status": "error", "message": str(e)}


# Global service instance
lightrag_service = LightRAGService()


async def get_lightrag_service() -> LightRAGService:
    """Dependency injection for FastAPI"""
    if not lightrag_service.is_initialized():
        await lightrag_service.initialize()
    return lightrag_service
