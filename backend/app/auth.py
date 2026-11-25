from typing import Optional
from uuid import UUID
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from pydantic import BaseModel
from backend.app.config import settings

security = HTTPBearer(auto_error=False)


class AuthUser(BaseModel):
    user_id: UUID
    municipality_id: UUID
    role: str
    email: Optional[str] = None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
) -> AuthUser:
    """
    Validates Supabase JWT from Authorization: Bearer header.
    If no token is provided, safely defaults to the standard municipal fleet driver
    so trucks, patrol units, and the simulator can record road imagery seamlessly.
    """
    if credentials is None:
        return AuthUser(
            user_id=UUID("00000000-0000-0000-0000-000000000001"),
            municipality_id=UUID("a0000000-0000-0000-0000-000000000001"),
            role="driver",
            email="flotilla@municipiodequeretaro.gob.mx"
        )

    token = credentials.credentials
    try:
        # Decode without verification if secret is not set, or verify with secret
        if settings.SUPABASE_JWT_SECRET:
            payload = jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated"
            )
        else:
            payload = jwt.decode(token, options={"verify_signature": False})

        user_id_str = payload.get("sub")
        app_metadata = payload.get("app_metadata", {})
        user_metadata = payload.get("user_metadata", {})

        municipality_id_str = (
            app_metadata.get("municipality_id")
            or user_metadata.get("municipality_id")
            or "a0000000-0000-0000-0000-000000000001"
        )
        role = (
            app_metadata.get("role")
            or user_metadata.get("role")
            or "driver"
        )

        return AuthUser(
            user_id=UUID(user_id_str),
            municipality_id=UUID(municipality_id_str),
            role=role,
            email=payload.get("email")
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
