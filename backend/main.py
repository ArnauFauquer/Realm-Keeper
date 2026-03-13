from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from routes.notes import router as notes_router, markdown_service
import asyncio
from pathlib import Path

from config.settings import settings
from config.logging import setup_logging
from config.cache import CacheControlMiddleware

logger = setup_logging(log_level=settings.LOG_LEVEL, log_dir=settings.LOG_DIR)

async def vault_sync_scheduler():
    sync_interval = settings.VAULT_SYNC_INTERVAL
    repo_url = settings.REPO_URL
    
    if sync_interval <= 0 or not repo_url:
        return
        
    while True:
        await asyncio.sleep(sync_interval)
        try:
            success = markdown_service.sync_repository()
            if success:
                markdown_service._cache.clear()
        except Exception as e:
            logger.exception("Error in scheduled vault sync")

@asynccontextmanager
async def lifespan(app: FastAPI):
    sync_task = asyncio.create_task(vault_sync_scheduler())
    yield
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="Realm Keeper API", lifespan=lifespan)

cors_origins = settings.CORS_ALLOWED_ORIGINS

app.add_middleware(CacheControlMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

assets_path = settings.VAULT_PATH / '_assets'

@app.get("/assets/{filename:path}")
async def get_asset(filename: str):
    file_path = assets_path / filename
    if not file_path.exists() or not file_path.is_file():
        return Response(status_code=404, content="File not found")
        
    primary_origin = cors_origins[0] if cors_origins else "*"
    return FileResponse(
        file_path,
        headers={
            "Access-Control-Allow-Origin": primary_origin,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    )

app.include_router(notes_router)

@app.get("/")
async def root():
    return {"message": "Welcome to Realm Keeper API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
