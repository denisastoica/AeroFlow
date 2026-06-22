"""
JWT Authentication Service
Handles token generation, validation, and user verification
"""
import os
import jwt
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List
from enum import Enum
from pathlib import Path
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[2] / ".env")


_raw_key = os.getenv("SECRET_KEY", "")
if not _raw_key or _raw_key in ("change-me-to-a-random-secret", ""):
    import warnings
    _raw_key = "fallback-dev-key-change-in-production"
    warnings.warn(
        "SECRET_KEY is not set or is the default placeholder. "
        "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\"",
        stacklevel=2,
    )
SECRET_KEY: str = _raw_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440


class Role(str, Enum):
    """User roles in the system"""
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    CUSTOMER = "customer"


class UserRole:
    """User role permissions mapping"""
    

    PERMISSIONS = {
        Role.ADMIN: ["*"],
        Role.DISPATCHER: [
            "GET:/drones",
            "GET:/deliveries",
            "POST:/deliveries/{id}/assign",
            "GET:/missions",
        ],
        Role.CUSTOMER: [
            "POST:/deliveries",
            "GET:/deliveries",
            "GET:/deliveries/{id}",
        ],
    }


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create JWT access token
    
    Args:
        data: Dictionary containing user info (sub: user_id, role, etc.)
        expires_delta: Token expiration time delta
        
    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[Dict]:
    """
    Verify and decode JWT token
    
    Args:
        token: JWT token string
        
    Returns:
        Decoded token payload if valid, None otherwise
    """
    try:

        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], leeway=30)
        user_id: int = payload.get("sub")
        role: str = payload.get("role")
        
        if user_id is None or role is None:
            return None
        
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def has_permission(role: str, method: str, path: str) -> bool:
    """
    Check if user role has permission to access endpoint
    
    Args:
        role: User role
        method: HTTP method (GET, POST, etc.)
        path: API endpoint path
        
    Returns:
        True if user has permission, False otherwise
    """
    try:
        user_role = Role(role)
    except ValueError:
        return False
    
    if user_role == Role.ADMIN:
        return True
    
    permissions = UserRole.PERMISSIONS.get(user_role, [])
    endpoint = f"{method}:{path}"
    

    return endpoint in permissions or "*" in permissions


def get_role_permissions(role: str) -> List[str]:
    """
    Get list of permissions for a given role
    
    Args:
        role: User role
        
    Returns:
        List of permission strings
    """
    try:
        user_role = Role(role)
    except ValueError:
        return []
    
    if user_role == Role.ADMIN:
        return ["*"]
    
    return UserRole.PERMISSIONS.get(user_role, [])
