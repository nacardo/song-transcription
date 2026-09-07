from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import init_db
from .routers import songs


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Song Transcription", lifespan=lifespan)

app.include_router(songs.router)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}
