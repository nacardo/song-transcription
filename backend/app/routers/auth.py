import secrets

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from ..config import settings

router = APIRouter(prefix="/api", tags=["auth"])


class LoginBody(BaseModel):
    password: str


@router.get("/session")
def session_status(request: Request) -> dict[str, bool]:
    return {"authed": bool(request.session.get("authed"))}


@router.post("/login")
def login(body: LoginBody, request: Request) -> dict[str, bool]:
    if not settings.app_password:
        # Refuse to authenticate anyone if the operator hasn't configured a
        # password. Prevents accidental "no password" deployments.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="APP_PASSWORD is not configured on the server.",
        )
    if not secrets.compare_digest(body.password, settings.app_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Wrong password",
        )
    request.session["authed"] = True
    return {"authed": True}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
