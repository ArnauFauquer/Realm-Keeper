from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from routes.notes import router as notes_router, markdown_service
from routes.chat import router as chat_router
import asyncio
from pathlib import Path

from config.settings import settings
from config.logging import setup_logging
from config.cache import CacheControlMiddleware

# Setup logging
logger = setup_logging(log_level=settings.LOG_LEVEL, log_dir=settings.LOG_DIR)

# Vault sync scheduler
async def vault_sync_scheduler():
    """Background task to periodically sync the vault repository"""
    
    sync_interval = settings.VAULT_SYNC_INTERVAL
    repo_url = settings.REPO_URL
    
    if sync_interval <= 0:
        logger.info("Vault sync disabled (VAULT_SYNC_INTERVAL <= 0)")
        return
    
    if not repo_url:
        logger.info("Vault sync disabled (no REPO_URL configured)")
        return
    
    logger.info(f"Vault sync scheduler started - syncing every {sync_interval} seconds")
    
    while True:
        await asyncio.sleep(sync_interval)
        try:
            logger.info(f"Running scheduled vault sync...")
            success = markdown_service.sync_repository()
            if success:
                markdown_service._cache.clear()  # Limpiar caché después de sync exitoso
                logger.info("Scheduled vault sync completed successfully")
            else:
                logger.warning("Scheduled vault sync failed")
        except Exception as e:
            logger.exception("Error in scheduled vault sync")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan events"""
    # Startup: create background sync task
    logger.info("Starting Realm Keeper API")
    sync_task = asyncio.create_task(vault_sync_scheduler())
    yield
    # Shutdown: cancel the sync task
    logger.info("Shutting down Realm Keeper API")
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        logger.info("Vault sync scheduler stopped")

app = FastAPI(title="Realm Keeper API", lifespan=lifespan)

# Configure CORS - use centralized settings
cors_origins = settings.CORS_ALLOWED_ORIGINS

# Add Cache Control middleware (debe ir antes de CORS)
app.add_middleware(CacheControlMiddleware)

# Add CORS middleware with correct configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods including OPTIONS
    allow_headers=["*"],  # Allow all headers
    expose_headers=["*"],  # Expose all headers
    max_age=600,  # Cache preflight responses for 10 minutes
)

# Custom endpoint for assets with CORS headers
assets_path = settings.VAULT_PATH / '_assets'

@app.get("/assets/{filename:path}")
async def get_asset(filename: str):
    """Serve static assets with proper CORS headers"""
    file_path = assets_path / filename
    if not file_path.exists() or not file_path.is_file():
        return Response(status_code=404, content="File not found")
    
    # Use the first configured origin for assets (primary frontend)
    primary_origin = cors_origins[0] if cors_origins else "*"
    return FileResponse(
        file_path,
        headers={
            "Access-Control-Allow-Origin": primary_origin,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    )

# Include routers
app.include_router(notes_router)
app.include_router(chat_router)

@app.get("/")
async def root():
    return {"message": "Welcome to Realm Keeper API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
