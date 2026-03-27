import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from routes.notes import router as notes_router

from config.settings import settings
from config.logging import setup_logging
from config.cache import CacheControlMiddleware

logger = setup_logging(log_level=settings.LOG_LEVEL, log_dir=settings.LOG_DIR)


def sync_vault() -> None:
    """Clone or pull the vault git repository on startup."""
    import shutil

    repo_url = settings.REPO_URL
    if not repo_url:
        logger.info("REPO_URL not set, skipping vault git sync.")
        return

    vault_path = settings.VAULT_PATH
    git_dir = vault_path / ".git"

    try:
        if git_dir.exists():
            logger.info(f"Vault already cloned at {vault_path}, pulling latest...")
            result = subprocess.run(
                ["git", "-C", str(vault_path), "pull"],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode == 0:
                logger.info(f"Vault sync successful: {result.stdout.strip()}")
            else:
                logger.error(f"Vault sync failed (exit {result.returncode}): {result.stderr.strip()}")
        else:
            # /vault may exist but be non-empty (e.g. created by mkdir elsewhere).
            # Clone into a temp sibling dir then replace to avoid the
            # "destination path already exists and is not an empty directory" error.
            tmp_path = Path("/tmp/_vault_clone_tmp")
            if tmp_path.exists():
                shutil.rmtree(tmp_path)

            logger.info(f"Cloning vault from {repo_url} into {tmp_path}...")
            result = subprocess.run(
                ["git", "clone", repo_url, str(tmp_path)],
                capture_output=True, text=True, timeout=300
            )

            if result.returncode == 0:
                logger.info("Clone successful, moving contents into vault...")
                # Cannot rmtree the PVC mount point itself — clear contents then move in.
                for item in vault_path.iterdir():
                    if item.is_dir():
                        shutil.rmtree(item)
                    else:
                        item.unlink()
                for item in tmp_path.iterdir():
                    shutil.move(str(item), str(vault_path / item.name))
                shutil.rmtree(tmp_path)
                logger.info("Vault sync successful.")
            else:
                logger.error(f"Vault sync failed (exit {result.returncode}): {result.stderr.strip()}")
                if tmp_path.exists():
                    shutil.rmtree(tmp_path)
    except subprocess.TimeoutExpired:
        logger.error("Vault sync timed out.")
    except Exception as e:
        logger.error(f"Vault sync error: {e}", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    sync_vault()
    yield


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
