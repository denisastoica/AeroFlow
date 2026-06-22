"""
Dependency injection helpers for authentication and authorization
"""
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from typing import Optional, List

from backend.database import get_db
from backend.models.user import User
from backend.services.auth_service import verify_token, Role
from backend.services.audit_service import log_unauthorized_access


async def get_current_user_payload(request: Request, db: Session = Depends(get_db)) -> dict:
    """
    Extract and validate JWT token from Authorization header.
    Returns token payload with user_id, email, and role.
    
    Usage:
        @app.get("/protected")
        def protected_route(user: dict = Depends(get_current_user_payload)):
            print(user["sub"])  # user_id
    """
    auth_header = request.headers.get("Authorization")
    
    if not auth_header:
        log_unauthorized_access(db, path=request.url.path, reason="Missing authorization header", ip_address=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        scheme, token = auth_header.split()
        if scheme.lower() != "bearer":
            raise ValueError("Invalid scheme")
    except ValueError:
        log_unauthorized_access(db, path=request.url.path, reason="Invalid authorization header format", ip_address=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format. Use: Authorization: Bearer <token>",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = verify_token(token)
    if not payload:
        log_unauthorized_access(db, path=request.url.path, reason="Invalid or expired token", ip_address=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return payload


async def get_current_user(
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db)
) -> User:
    """
    Get current authenticated user from database.
    
    Usage:
        @app.get("/profile")
        def get_profile(user: User = Depends(get_current_user)):
            return {"user_id": user.id, "email": user.email}
    """
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        log_unauthorized_access(db, path=request.url.path if hasattr(request, "url") else "unknown", reason="User not found", email=payload.get("email"))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    
    if not user.is_active:
        log_unauthorized_access(db, path=request.url.path if hasattr(request, "url") else "unknown", reason="User account is disabled", email=payload.get("email"))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled"
        )
    
    return user


def require_role(*allowed_roles: str):
    """
    Dependency to require specific user roles.
    Admin always has access.
    
    Usage:
        @app.get("/admin-only", dependencies=[Depends(require_role("admin"))])
        def admin_route():
            return {"message": "Admin access"}
        
        @app.get("/dispatcher-or-admin", dependencies=[Depends(require_role("dispatcher", "admin"))])
        def dispatcher_route():
            return {"message": "Dispatcher access"}
    """
    async def role_checker(
        payload: dict = Depends(get_current_user_payload),
        request: Request = None,
        db: Session = Depends(get_db)
    ) -> dict:
        user_role = payload.get("role")
        

        if user_role == "admin":
            return payload
        

        if user_role not in allowed_roles:
            path = request.url.path if request and hasattr(request, "url") else "unknown"
            ip = request.client.host if request and hasattr(request, "client") and request.client else None
            user_agent = request.headers.get("user-agent") if request and hasattr(request, "headers") else None
            log_unauthorized_access(db, path=path, reason=f"Insufficient permissions. Required roles: {', '.join(allowed_roles)}", email=payload.get("email"), ip_address=ip, user_agent=user_agent)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {', '.join(allowed_roles)}"
            )
        
        return payload
    
    return role_checker


def require_roles_and_user(*allowed_roles: str):
    """
    Combined dependency that returns both the user object and validates role.
    
    Usage:
        @app.get("/profile", dependencies=[Depends(require_roles_and_user("customer", "admin"))])
        def get_profile(user: User = Depends(get_current_user)):
            return user
    """
    async def check(
        payload: dict = Depends(get_current_user_payload),
        user: User = Depends(get_current_user),
        request: Request = None,
        db: Session = Depends(get_db)
    ) -> User:
        user_role = payload.get("role")
        
        if user_role == "admin":
            return user
        
        if user_role not in allowed_roles:
            path = request.url.path if request and hasattr(request, "url") else "unknown"
            ip = request.client.host if request and hasattr(request, "client") and request.client else None
            user_agent = request.headers.get("user-agent") if request and hasattr(request, "headers") else None
            log_unauthorized_access(db, path=path, reason=f"Insufficient permissions. Required roles: {', '.join(allowed_roles)}", email=payload.get("email"), ip_address=ip, user_agent=user_agent)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {', '.join(allowed_roles)}"
            )
        
        return user
    
    return check


require_admin = Depends(require_role("admin"))
require_dispatcher = Depends(require_role("dispatcher", "admin"))
require_customer = Depends(require_role("customer", "admin"))
require_authenticated = Depends(get_current_user)
