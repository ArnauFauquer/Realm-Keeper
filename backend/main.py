from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from routes.notes import router as notes_router
from routes.chat import router as chat_router
import os
import asyncio
from pathlib import Path

# Vault sync scheduler
async def vault_sync_scheduler():
    """Background task to periodically sync the vault repository"""
    from services.obsidian_service import ObsidianService
    
    sync_interval = int(os.getenv('VAULT_SYNC_INTERVAL', '3600'))  # Default: 1 hour
    vault_path = os.getenv('VAULT_PATH', '/app/vault')
    repo_url = os.getenv('REPO_URL', '')
    
    if sync_interval <= 0:
        print("Vault sync disabled (VAULT_SYNC_INTERVAL <= 0)")
        return
    
    if not repo_url:
        print("Vault sync disabled (no REPO_URL configured)")
        return
    
    print(f"Vault sync scheduler started - syncing every {sync_interval} seconds")
    
    while True:
        await asyncio.sleep(sync_interval)
        try:
            print(f"Running scheduled vault sync...")
            service = ObsidianService(vault_path=vault_path, repo_url=repo_url)
            success = service.sync_repository()
            if success:
                print("Scheduled vault sync completed successfully")
            else:
                print("Scheduled vault sync failed")
        except Exception as e:
            print(f"Error in scheduled vault sync: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan events"""
    # Startup: create background sync task
    sync_task = asyncio.create_task(vault_sync_scheduler())
    yield
    # Shutdown: cancel the sync task
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        print("Vault sync scheduler stopped")

app = FastAPI(title="Realm Keeper API", lifespan=lifespan)

# Configure CORS - use environment variable for allowed origins
cors_origins_env = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
cors_origins = [origin.strip() for origin in cors_origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# Custom endpoint for assets with CORS headers
vault_path = Path(os.getenv('VAULT_PATH', '/app/vault'))
assets_path = vault_path / '_assets'

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
