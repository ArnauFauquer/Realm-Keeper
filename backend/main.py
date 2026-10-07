import asyncio
import os
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from routes.auth import require_auth
from routes.auth import router as auth_router
from routes.notes import md_service_instance, router as notes_router
from routes.sheets import router as sheets_router
from routes.encounters import router as encounters_router
from routes.battlemaps import router as battlemaps_router
from routes.characters import router as characters_router
from routes.adversaries import router as adversaries_router
from routes.sync import router as sync_router
from routes.screen import router as screen_router
from routes.player import router as player_router
from routes.charts import router as charts_router
from routes.vistas import router as vistas_router
from routes.observatory import router as observatory_router

from config.settings import settings
from config.logging import setup_logging
from config.cache import CacheControlMiddleware
from config.csrf import OriginCheckMiddleware
from services.doc_registry import hub as doc_hub, import_legacy_documents
from services.git_sync_utils import GitCommitError, clear_stale_index_lock, pull_rebase, redact_credentials, run_git
from services.sheet_import import convert_yaml_sheets, import_note_sheets

logger = setup_logging(log_level=settings.LOG_LEVEL, log_dir=settings.LOG_DIR)


def _mark_vault_safe(vault_path: Path) -> None:
    """Marks the vault a safe directory, avoiding "dubious ownership" errors
    (the container runs as UID 1000 but the vault mount may be owned by
    root). Once: `--add` on every sync appended the same line to
    ~/.gitconfig every few minutes."""
    listed = subprocess.run(
        ["git", "config", "--global", "--get-all", "safe.directory"], capture_output=True, text=True,
    )
    if str(vault_path) not in listed.stdout.splitlines():
        subprocess.run(
            ["git", "config", "--global", "--add", "safe.directory", str(vault_path)], capture_output=True, text=True,
        )


def sync_vault() -> None:
    """Clone the vault git repository, or pull it if it is cloned. Run under
    the vault's lock (MarkdownService.git_lock) once requests are served, so a
    pull never runs alongside a note's commit."""
    import shutil

    if not settings.GIT_ENABLED:
        return
    repo_url = settings.REPO_URL
    vault_path = settings.VAULT_PATH
    _mark_vault_safe(vault_path)
    git_dir = vault_path / ".git"

    try:
        if git_dir.exists():
            logger.info(f"Vault already cloned at {vault_path}, pulling latest...")
            if repo_url:
                # Always ensure the remote URL matches the current env var before pulling
                run_git(vault_path, "remote", "set-url", "origin", repo_url)
            # Rebasing: after a push that failed, the vault has commits of its
            # own, and a plain pull of diverged history either fails or merges.
            result = pull_rebase(vault_path)
            if result.returncode == 0:
                logger.info(f"Vault sync successful: {redact_credentials(result.stdout.strip())}")
            else:
                logger.error(f"Vault sync failed (exit {result.returncode}): {redact_credentials(result.stderr.strip())}")
        elif not repo_url:
            logger.error(f"GIT_ENABLED without a REPO_URL, but {vault_path} is not a git clone: nothing to pull.")
        else:
            # /vault may exist but be non-empty (e.g. created by mkdir elsewhere).
            # Clone into a temp sibling dir then replace to avoid the
            # "destination path already exists and is not an empty directory" error.
            tmp_path = Path("/tmp/_vault_clone_tmp")
            if tmp_path.exists():
                shutil.rmtree(tmp_path)

            logger.info(f"Cloning vault from {redact_credentials(repo_url)} into {tmp_path}...")
            result = subprocess.run(
                ["git", "clone", repo_url, str(tmp_path)],
                capture_output=True, text=True, timeout=300
            )

            if result.returncode == 0:
                logger.info("Clone successful, moving contents into vault...")
                # Cannot rmtree the vault mount point itself — clear contents then move in.
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
                logger.error(f"Vault sync failed (exit {result.returncode}): {redact_credentials(result.stderr.strip())}")
                if tmp_path.exists():
                    shutil.rmtree(tmp_path)
    except (subprocess.TimeoutExpired, GitCommitError) as e:
        logger.error(f"Vault sync timed out: {e}")
    except Exception as e:
        logger.error(f"Vault sync error: {redact_credentials(str(e))}")


async def _watch_vault():
    """Without git, the vault is a folder that something else may write too
    (Obsidian, on the same volume): notice its notes changing and drop the
    parsed-note caches, as a pull would, so an edit there shows within a few
    seconds rather than once the caches expire."""
    interval = settings.VAULT_WATCH_INTERVAL
    if interval <= 0:
        logger.info("Vault watch disabled (VAULT_WATCH_INTERVAL <= 0).")
        return
    logger.info(f"Watching the vault for changes every {interval}s.")
    seen = await asyncio.to_thread(md_service_instance.fingerprint)
    while True:
        await asyncio.sleep(interval)
        try:
            now = await asyncio.to_thread(md_service_instance.fingerprint)
        except Exception as e:
            logger.error(f"Vault watch error: {e}")
            continue
        if now != seen:
            seen = now
            logger.info("The vault changed on disk: reloading notes.")
            md_service_instance.invalidate_cache()


async def _periodic_sync():
    if not settings.GIT_ENABLED:
        await _watch_vault()
        return
    interval = settings.GIT_SYNC_INTERVAL
    if interval <= 0:
        logger.info("Periodic vault sync disabled (GIT_SYNC_INTERVAL <= 0).")
        return
    logger.info(f"Periodic vault sync enabled every {interval}s.")
    while True:
        await asyncio.sleep(interval)
        logger.info("Running periodic vault sync...")
        await asyncio.to_thread(md_service_instance.under_git_lock, sync_vault)
        # A pull can add, change or newly hide (ignore-tag) notes: drop the
        # parsed-note caches so none of that waits out their 5-minute TTL.
        md_service_instance.invalidate_cache()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        f"Vault: {settings.VAULT_PATH} ({'git' if settings.GIT_ENABLED else 'a plain folder, no git'}); "
        f"storage: {settings.STORAGE_BACKEND}"
        + (f" ({settings.STORAGE_LOCAL_PATH})" if settings.STORAGE_BACKEND == "local" else f" (bucket {settings.S3_BUCKET_NAME})")
        + f"; login: {'on' if settings.ENABLE_AUTH else 'off'}"
    )
    if settings.GIT_ENABLED:
        # Nothing else runs git yet: a lock a killed git left (a restart in the
        # middle of a push) would otherwise block every commit from now on.
        clear_stale_index_lock(settings.VAULT_PATH)
    sync_vault()
    # In k8s the vault is an emptyDir, so a failed first clone would leave the
    # pod serving (and turning ready with) an empty vault. Crash instead, so
    # the kubelet retries and a rolling update never replaces a working pod.
    # A failed pull over an existing clone stays non-fatal: that vault still
    # has content, just possibly stale.
    if settings.GIT_ENABLED and settings.REPO_URL and not (settings.VAULT_PATH / ".git").exists():
        raise RuntimeError("Vault clone failed; refusing to start with an empty vault.")
    # Charts and vistas used to be kept in the vault: bring in any that haven't
    # been (once; nothing in the vault is touched).
    await asyncio.to_thread(import_legacy_documents, settings.VAULT_PATH)
    # Sheets used to be ```sheet blocks in notes: make documents of them (once).
    await asyncio.to_thread(import_note_sheets, settings.VAULT_PATH)
    # And then were YAML in their documents: they are JSON now (once).
    await asyncio.to_thread(convert_yaml_sheets)
    task = asyncio.create_task(_periodic_sync())
    housekeeping = asyncio.create_task(doc_hub.run_housekeeping())
    yield
    for background in (task, housekeeping):
        background.cancel()
        try:
            await background
        except asyncio.CancelledError:
            pass
    # Whatever was edited in the last few seconds hasn't been written yet.
    await doc_hub.flush_all()


if settings.ENABLE_AUTH and not os.getenv("SESSION_SECRET_KEY"):
    logger.warning("SESSION_SECRET_KEY is not set: using a random per-process key (sessions reset on restart).")

app = FastAPI(title="Realm Keeper API", lifespan=lifespan)

cors_origins = settings.CORS_ALLOWED_ORIGINS

app.add_middleware(CacheControlMiddleware)

app.add_middleware(OriginCheckMiddleware, allowed_origins=[*cors_origins, settings.FRONTEND_URL])

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

# Only used for the brief OAuth handshake (state/nonce) — separate from our
# own long-lived rk_session cookie issued in routes/auth.py.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_SECRET_KEY,
    same_site="lax",
    https_only=settings.SESSION_COOKIE_SECURE,
)

app.include_router(auth_router)
app.include_router(notes_router)  # reading/searching notes stays public; writes are gated per-route
app.include_router(sheets_router)  # every character's and adversary's sheet, read: login required
app.include_router(encounters_router)  # live documents: login required throughout
app.include_router(characters_router)
app.include_router(adversaries_router)  # login required, like charts
app.include_router(battlemaps_router)
app.include_router(sync_router)  # the socket that announces their changes: login required
app.include_router(screen_router)  # the socket needs login or a paired screen; posting to it needs login
app.include_router(player_router, dependencies=[Depends(require_auth)])
app.include_router(charts_router)  # login, or a paired screen for what it shows (routes/screen_access.py)
app.include_router(vistas_router)  # login, or a paired screen for what it shows (routes/screen_access.py)
app.include_router(observatory_router)  # login, or a paired screen for the images it shows (routes/screen_access.py)

@app.get("/")
async def root():
    return {"message": "Welcome to Realm Keeper API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
