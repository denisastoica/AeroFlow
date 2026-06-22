"""
DEPRECATED — This module is no longer used.

All authentication logic lives in auth_dependencies.py:
  - get_current_user()   → extracts & validates JWT from Authorization header
  - require_role(...)    → FastAPI dependency that enforces role-based access

This file is kept only to avoid import errors in case of stale .pyc caches.
"""
