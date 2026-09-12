from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .config import settings as app_settings
from .db import init_db
from .routers import auth, dictionary, lyrics, phrases, progress, settings, songs


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Song Transcription", lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=app_settings.session_secret,
    same_site="lax",
    https_only=app_settings.session_https_only,
)

app.include_router(auth.router)
app.include_router(songs.router)
app.include_router(progress.router)
app.include_router(settings.router)
app.include_router(lyrics.router)
app.include_router(dictionary.router)
app.include_router(phrases.router)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


# --- Static frontend + SPA fallback ---
# In prod the Docker image copies the built frontend into /app/static and
# sets STATIC_DIR=/app/static. In dev we skip this entirely so Vite owns the
# frontend on :5173 and the FastAPI process is API-only.
if app_settings.static_dir:
    _static_root = Path(app_settings.static_dir).resolve()
    _assets_dir = _static_root / "assets"
    _index_file = _static_root / "index.html"

    if _assets_dir.is_dir():
        # Vite emits hashed filenames under /assets, so aggressive caching is
        # safe. StaticFiles' default headers are fine for our purposes.
        app.mount(
            "/assets",
            StaticFiles(directory=_assets_dir),
            name="assets",
        )

    # Catch-all that serves any real file at the site root (favicon.ico,
    # robots.txt, …) and otherwise returns index.html so the React router
    # can handle client-side routes like /callback. Registered LAST so
    # explicit routes above win; /api/* that doesn't match is 404'd
    # explicitly rather than being handed the SPA HTML.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str = "") -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        # Guard against path escapes (e.g. "..") before touching the disk.
        candidate = (_static_root / full_path).resolve()
        try:
            candidate.relative_to(_static_root)
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found") from None
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_index_file)
