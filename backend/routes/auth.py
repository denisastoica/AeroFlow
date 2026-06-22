"""
Authentication routes: register, login, verify token, user profile, password reset
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
import os
import random
import bcrypt
from datetime import timedelta, datetime, timezone
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.database import get_db
from backend.models.user import User
from backend.schemas.auth import (
    UserRegisterRequest, UserLoginRequest, UserResponse, TokenResponse,
    ForgotPasswordRequest, ResetPasswordRequest, MessageResponse,
)
from backend.services.auth_service import create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES, Role
from backend.services.auth_dependencies import get_current_user
from backend.services.audit_service import log_user_login, log_user_login_failed, log_user_logout
from backend.services.email_service import send_password_reset_email

router = APIRouter(prefix="/auth", tags=["auth"])


_is_testing = os.getenv("TESTING") == "1"
limiter = Limiter(
    key_func=get_remote_address,
    enabled=not _is_testing,
)


_reset_codes: dict[str, dict] = {}
_RESET_CODE_EXPIRY_MINUTES = 15
_MAX_RESET_ATTEMPTS = 5


def _generate_reset_code() -> str:
    """Generate a 6-digit numeric reset code."""
    return f"{random.randint(100000, 999999)}"


def _cleanup_expired_codes():
    """Remove expired codes from memory."""
    now = datetime.now(timezone.utc)
    expired = [email for email, data in _reset_codes.items() if data["expires_at"] < now]
    for email in expired:
        del _reset_codes[email]


def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_user_by_email(db: Session, email: str) -> User:
    """Get user from database by email"""
    return db.query(User).filter(User.email == email).first()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register_user(request: Request, user_data: UserRegisterRequest, db: Session = Depends(get_db)):
    """
    Register a new user
    
    Default role is 'customer'. Admins must create other roles manually.
    """

    existing_user = get_user_by_email(db, user_data.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    

    try:
        Role(user_data.role)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join([r.value for r in Role])}"
        )
    

    if user_data.role != "customer":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only 'customer' role allowed for self-registration"
        )
    

    hashed_pwd = hash_password(user_data.password)
    new_user = User(
        email=user_data.email,
        hashed_password=hashed_pwd,
        name=user_data.name,
        phone=user_data.phone,
        role=user_data.role,
        is_active=True,
        last_login=datetime.now(timezone.utc)
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": new_user.id, "email": new_user.email, "role": new_user.role},
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": UserResponse.model_validate(new_user)
    }


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login_user(request: Request, credentials: UserLoginRequest, db: Session = Depends(get_db)):
    """
    Login user and return JWT token
    """
    try:

        user = get_user_by_email(db, credentials.email)
        if not user:
            ip_address = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")
            log_user_login_failed(db, credentials.email, "Invalid email or password", ip_address=ip_address, user_agent=user_agent)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )

        if not user.is_active:
            ip_address = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")
            log_user_login_failed(db, credentials.email, "Account disabled", ip_address=ip_address, user_agent=user_agent)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is disabled"
            )

        if not verify_password(credentials.password, user.hashed_password):
            ip_address = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")
            log_user_login_failed(db, credentials.email, "Invalid email or password", ip_address=ip_address, user_agent=user_agent)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )

        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": user.id, "email": user.email, "role": user.role},
            expires_delta=access_token_expires
        )

        user.last_login = datetime.now(timezone.utc)


        ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        log_user_login(db, user, ip_address=ip_address, user_agent=user_agent)
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": UserResponse.model_validate(user)
        }
    except Exception as e:
        import traceback
        print("[ERROR] Exception in /login endpoint:")
        traceback.print_exc()
        raise


@router.get("/me", response_model=UserResponse)
def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """
    Get current authenticated user's profile.
    Requires valid JWT token in Authorization header.
    """
    return UserResponse.model_validate(current_user)


@router.post("/logout")
def logout_user(request: Request, db: Session = Depends(get_db)):
    """
    Logout user (client-side token deletion)
    Real logout is handled client-side by deleting the token.
    This endpoint exists for API completeness.
    """
    from backend.services.auth_service import verify_token
    auth_header = request.headers.get("Authorization")
    if auth_header:
        try:
            scheme, token = auth_header.split()
            if scheme.lower() == "bearer":
                payload = verify_token(token)
                if payload and payload.get("sub"):
                    user = db.query(User).filter(User.id == payload.get("sub")).first()
                    if user:
                        ip_address = request.client.host if request.client else None
                        user_agent = request.headers.get("user-agent")
                        log_user_logout(db, user, ip_address=ip_address, user_agent=user_agent)
        except Exception:
            pass
    return {
        "message": "Logged out successfully"
    }


@router.post("/forgot-password", response_model=MessageResponse)
@limiter.limit("20/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Step 1: User provides email, receives a 6-digit reset code via email.
    Always returns success to prevent email enumeration attacks.
    """
    _cleanup_expired_codes()

    user = get_user_by_email(db, body.email)


    success_msg = "If an account with this email exists, a reset code has been sent."

    if not user or not user.is_active:
        return MessageResponse(message=success_msg)


    code = _generate_reset_code()
    _reset_codes[body.email.lower()] = {
        "code": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=_RESET_CODE_EXPIRY_MINUTES),
        "attempts": 0,
    }


    send_password_reset_email(
        recipient_email=user.email,
        recipient_name=user.name or user.email,
        reset_code=code,
    )

    return MessageResponse(message=success_msg)


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("20/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    """
    Step 2: User provides email, reset code, and new password.
    """
    _cleanup_expired_codes()

    email_key = body.email.lower()
    stored = _reset_codes.get(email_key)

    if not stored:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No reset code found for this email. Please request a new one."
        )


    if stored["attempts"] >= _MAX_RESET_ATTEMPTS:
        del _reset_codes[email_key]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Too many failed attempts. Please request a new reset code."
        )


    if stored["expires_at"] < datetime.now(timezone.utc):
        del _reset_codes[email_key]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset code has expired. Please request a new one."
        )


    if stored["code"] != body.code:
        stored["attempts"] += 1
        remaining = _MAX_RESET_ATTEMPTS - stored["attempts"]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid reset code. {remaining} attempt(s) remaining."
        )


    user = get_user_by_email(db, body.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )


    if verify_password(body.new_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from your current password."
        )

    user.hashed_password = hash_password(body.new_password)
    db.commit()


    del _reset_codes[email_key]

    return MessageResponse(message="Password has been reset successfully. You can now log in.")
