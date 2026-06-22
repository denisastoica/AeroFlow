"""
Pydantic schemas for authentication
"""
import re
from pydantic import BaseModel, EmailStr, ConfigDict, field_validator, Field
from typing import Optional
from datetime import datetime


VALID_ROLES = ["admin", "dispatcher", "customer"]


_PASSWORD_PATTERN = re.compile(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$')


class UserRegisterRequest(BaseModel):
    """User registration request"""
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = None
    role: str = "customer"

    @field_validator('password')
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not _PASSWORD_PATTERN.match(v):
            raise ValueError(
                'Password must be at least 8 characters and contain '
                'an uppercase letter, a lowercase letter, and a digit'
            )
        return v

    @field_validator('name')
    @classmethod
    def validate_name_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Name cannot be blank')
        return v.strip()

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f'Invalid role. Must be one of: {", ".join(VALID_ROLES)}')
        return v


class UserLoginRequest(BaseModel):
    """User login request"""
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    """User response (safe, no password)"""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    email: str
    name: str
    phone: Optional[str]
    role: str
    is_active: bool
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator('last_login', 'created_at', 'updated_at', mode='after')
    @classmethod
    def ensure_utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v and v.tzinfo is None:
            from datetime import timezone
            return v.replace(tzinfo=timezone.utc)
        return v


class TokenResponse(BaseModel):
    """JWT token response"""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenPayload(BaseModel):
    """JWT token payload"""
    sub: int
    email: str
    role: str
    exp: datetime


class AdminUserCreate(BaseModel):
    """Admin: create a user with any role."""
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = None
    role: str = "customer"

    @field_validator('password')
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not _PASSWORD_PATTERN.match(v):
            raise ValueError(
                'Password must be at least 8 characters and contain '
                'an uppercase letter, a lowercase letter, and a digit'
            )
        return v

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f'Invalid role. Must be one of: {", ".join(VALID_ROLES)}')
        return v


class AdminUserUpdate(BaseModel):
    """Admin: partial update of a user."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f'Invalid role. Must be one of: {", ".join(VALID_ROLES)}')
        return v


class ForgotPasswordRequest(BaseModel):
    """Request to receive a password reset code via email."""
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Request to set a new password using the reset code."""
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)

    @field_validator('new_password')
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not _PASSWORD_PATTERN.match(v):
            raise ValueError(
                'Password must be at least 8 characters and contain '
                'an uppercase letter, a lowercase letter, and a digit'
            )
        return v


class MessageResponse(BaseModel):
    """Generic message response."""
    message: str
