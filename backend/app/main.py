from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Song Transcription", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}
