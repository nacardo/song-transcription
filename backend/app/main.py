from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from .config import settings as app_settings
from .db import init_db
from .routers import auth, progress, settings, songs


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


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}
