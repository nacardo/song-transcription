from fastapi import HTTPException, Request, status


def require_auth(request: Request) -> None:
    """Dependency guarding routers behind the single-user password login.

    Attached at the router level (dependencies=[Depends(require_auth)]) so
    every route on the router requires the signed session cookie.
    """
    if not request.session.get("authed"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
