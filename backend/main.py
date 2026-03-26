from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from routes.notes import router as notes_router

from config.settings import settings
from config.logging import setup_logging
from config.cache import CacheControlMiddleware

logger = setup_logging(log_level=settings.LOG_LEVEL, log_dir=settings.LOG_DIR)

app = FastAPI(title="Realm Keeper API")

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

@app.get("/vault-assets/{filename:path}")
async def get_asset(filename: str):
    file_path = (assets_path / filename).resolve()
    assets_resolved = assets_path.resolve()
    
    try:
        file_path.relative_to(assets_resolved)
    except ValueError:
        return Response(status_code=403, content="Access denied: invalid path")
        
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
