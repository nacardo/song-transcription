from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..db import get_session
from ..models import AppSettings, SettingsPatch, SettingsRead

router = APIRouter(prefix="/api/settings", tags=["settings"])

SINGLETON_ID = 1


@router.get("", response_model=SettingsRead, response_model_by_alias=True)
def get_settings(session: Session = Depends(get_session)) -> AppSettings:
    row = session.get(AppSettings, SINGLETON_ID)
    # Return an unpersisted row of defaults so the frontend always sees a
    # complete Settings object.
    return row or AppSettings(id=SINGLETON_ID)


@router.patch("", response_model=SettingsRead, response_model_by_alias=True)
def patch_settings(
    patch: SettingsPatch,
    session: Session = Depends(get_session),
) -> AppSettings:
    row = session.get(AppSettings, SINGLETON_ID) or AppSettings(id=SINGLETON_ID)
    # exclude_unset so an omitted field means "keep existing", not "reset".
    for k, v in patch.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
