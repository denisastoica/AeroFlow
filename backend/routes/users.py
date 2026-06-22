"""
Admin user management routes.
Uses the same bcrypt hashing and role system as auth.py.
All endpoints require admin authentication.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from backend.database import get_db
from backend.models.user import User
from backend.routes.auth import hash_password
from backend.schemas.auth import UserResponse, AdminUserCreate, AdminUserUpdate
from backend.services.auth_service import Role
from backend.services.auth_dependencies import get_current_user, require_role

router = APIRouter(prefix="/users", tags=["Users"])


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != Role.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


@router.get("/", response_model=List[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """List all users (admin only)."""
    return [UserResponse.model_validate(u) for u in db.query(User).order_by(User.id).all()]


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Get a single user by ID (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse.model_validate(user)


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    data: AdminUserCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Create a user with any role (admin only)."""
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        name=data.name,
        phone=data.phone,
        role=data.role,
        is_active=True,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return UserResponse.model_validate(new_user)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    data: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Update user fields (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    active_admins_count = db.query(User).filter(
        User.role == Role.ADMIN.value,
        User.is_active == True,
    ).count()

    next_role = data.role if data.role is not None else user.role
    next_is_active = data.is_active if data.is_active is not None else user.is_active


    if user.id == admin.id and user.role == Role.ADMIN.value and next_role != Role.ADMIN.value:
        raise HTTPException(status_code=400, detail="Cannot remove your own admin role")


    if (
        user.role == Role.ADMIN.value
        and user.is_active
        and active_admins_count <= 1
        and (next_role != Role.ADMIN.value or not next_is_active)
    ):
        raise HTTPException(status_code=400, detail="At least one active admin must remain")

    if data.role is not None:
        user.role = data.role

    if data.name is not None:
        user.name = data.name
    if data.phone is not None:
        user.phone = data.phone
    if data.is_active is not None:
        user.is_active = data.is_active

    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Delete a user (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    active_admins_count = db.query(User).filter(
        User.role == Role.ADMIN.value,
        User.is_active == True,
    ).count()

    if user.role == Role.ADMIN.value and user.is_active and active_admins_count <= 1:
        raise HTTPException(status_code=400, detail="At least one active admin must remain")
    

    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    db.delete(user)
    db.commit()
    return None
