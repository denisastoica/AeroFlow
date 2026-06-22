# Authentication & Authorization Guide

## Overview

The authentication and authorization system implements **JWT-based authentication** with **role-based access control (RBAC)**.

### User Roles

1. **admin** - Full access to all resources
2. **dispatcher** - Manages deliveries and drones (manager)
3. **customer** - Creates and tracks deliveries

---

## API Endpoints

### Authentication Routes (`/auth`)

#### 1. Register New User

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe",
  "phone": "+40701234567",
  "role": "customer"
}
```

**Response:**

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "phone": "+40701234567",
    "role": "customer",
    "is_active": true,
    "created_at": "2026-03-12T10:30:00",
    "updated_at": "2026-03-12T10:30:00"
  }
}
```

**Notes:**

- Only `customer` role allowed for self-registration
- Other roles must be created by admin
- Password must meet security requirements

---

#### 2. Login User

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:** Same as register (returns JWT token + user info)

---

#### 3. Get Current User Profile

```http
GET /auth/me
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "John Doe",
  "phone": "+40701234567",
  "role": "customer",
  "is_active": true,
  "created_at": "2026-03-12T10:30:00",
  "updated_at": "2026-03-12T10:30:00"
}
```

---

#### 4. Logout User

```http
POST /auth/logout
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "message": "Logged out successfully",
  "user_id": 1
}
```

**Note:** Actual logout is client-side (delete token from storage)

---

## Protected Routes

### Authorization Header

All protected routes require the header:

```
Authorization: Bearer <access_token>
```

### Example Protected Request

```http
GET /drones
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
```

---

## Role-Based Access Control (RBAC)

### Drones Routes (`/drones`)

| Endpoint              | Method | Allowed Roles             | Description          |
| --------------------- | ------ | ------------------------- | -------------------- |
| `/`                   | GET    | Authenticated users       | List all drones      |
| `/`                   | POST   | dispatcher, admin         | Create new drone     |
| `/add_by_address`     | POST   | dispatcher, admin         | Add drone by address |
| `/{id}`               | GET    | Authenticated users       | Get drone details    |
| `/{id}/start_mission` | POST   | dispatcher, admin         | Start drone mission  |

---

### Deliveries Routes (`/deliveries`)

| Endpoint         | Method | Allowed Roles             | Description              |
| ---------------- | ------ | ------------------------- | ------------------------ |
| `/`              | GET    | Authenticated users       | List deliveries          |
| `/`              | POST   | Authenticated users       | Create new delivery      |
| `/{id}`          | GET    | Authenticated users       | Get delivery details     |
| `/{id}/assign`   | POST   | dispatcher, admin         | Assign drone to delivery |
| `/{id}/status`   | PATCH  | dispatcher, admin         | Update delivery status   |
| `/stats/summary` | GET    | Authenticated users       | Get delivery statistics  |

---

### Missions Routes (`/missions`)

| Endpoint       | Method | Allowed Roles       | Description            |
| -------------- | ------ | ------------------- | ---------------------- |
| `/`            | GET    | Authenticated users | List all missions      |
| `/stats`       | GET    | Authenticated users | Get mission statistics |
| `/{id}/events` | GET    | Authenticated users | Get mission events     |

---

## JWT Token Structure

Token payload example:

```json
{
  "sub": 1, // user_id
  "email": "user@example.com",
  "role": "customer",
  "exp": 1710328199 // expiration timestamp
}
```

**Token Expiration:** 480 minutes (8 hours)

---

## Error Responses

### 401 Unauthorized

```json
{
  "detail": "Invalid or expired token"
}
```

### 403 Forbidden

```json
{
  "detail": "Insufficient permissions. Required roles: dispatcher, admin"
}
```

### 400 Bad Request

```json
{
  "detail": "Email already registered"
}
```

---

## Testing with Swagger UI

1. Open `http://localhost:8000/docs`
2. Click the "Authorize" button (top-right)
3. Enter JWT token: `Bearer <your_token>`
4. All endpoints now include Authorization header

---

## Example Workflow

### 1. Register & Login

```bash
# Register
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "password": "Password123!",
    "name": "John Doe",
    "role": "customer"
  }'

# Save the returned access_token
```

### 2. Create Delivery

```bash
curl -X POST http://localhost:8000/deliveries \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "pickup_lat": 46.7712,
    "pickup_lon": 23.6236,
    "dest_lat": 46.7750,
    "dest_lon": 23.6300
  }'
```

### 3. List Drones

```bash
curl -X GET http://localhost:8000/drones \
  -H "Authorization: Bearer <token>"
```

### 4. Assign Delivery (dispatcher only)

```bash
curl -X POST http://localhost:8000/deliveries/1/assign \
  -H "Authorization: Bearer <token>"
```

---

## Security Best Practices

1. **Store tokens securely** - Use HTTP-only cookies or secure storage
2. **Token expiration** - Tokens expire after 8 hours (change in production)
3. **HTTPS only** - Always use HTTPS in production (not HTTP)
4. **Strong passwords** - Enforce password requirements
5. **Rate limiting** - Consider adding rate limiting to prevent brute force
6. **Rotate secrets** - Change SECRET_KEY in production
7. **Environment variables** - Never hardcode secrets

---

## Environment Configuration

Change these values in `backend/services/auth_service.py`:

```python
SECRET_KEY = "your-production-secret-key"  # Change this!
SLEEP_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # Adjust as needed
```

---

## Admin User Management

To create admin/dispatcher users, use database directly or create admin endpoints:

```python
# Create user in database
from backend.models.user import User
from backend.routes.auth import hash_password

admin = User(
    email="admin@example.com",
    hashed_password=hash_password("AdminPassword123!"),
    name="Admin User",
    role="admin",
    is_active=True
)
db.add(admin)
db.commit()
```

---

## Troubleshooting

### "Missing authorization header"

- Ensure you're including `Authorization: Bearer <token>` header
- Check token is not expired

### "Invalid or expired token"

- Token has expired (regenerate with login)
- Token is malformed
- Wrong SECRET_KEY used

### "Insufficient permissions"

- Your user role doesn't have access to this endpoint
- Only admin can override role restrictions

---

## Next Steps

- [ ] Set environment variables for secrets
- [ ] Implement refresh token mechanism
- [ ] Add rate limiting
- [ ] Add password reset functionality
- [ ] Add account deactivation
- [ ] Add admin user management endpoints
- [ ] Implement token blacklist for logout

---

# User Integration + Ownership Logic

## Overview

Complete user management system with **ownership logic** and **personalized dashboards** per role.

## Delivery Ownership

Each delivery belongs to a user (customer_id):

- **Customer** - Sees only own deliveries
- **Dispatcher** - Sees all deliveries (management)
- **Admin** - Sees all deliveries (admin access)

### Database Schema

```sql
ALTER TABLE deliveries ADD COLUMN customer_id INTEGER NOT NULL;
ALTER TABLE deliveries ADD CONSTRAINT fk_customer_delivery
  FOREIGN KEY (customer_id) REFERENCES users(id);
```

---

## Delivery Endpoints with Ownership

### Create Delivery (Auto-ownership)

```http
POST /deliveries
Authorization: Bearer <token>
Content-Type: application/json

{
  "pickup_lat": 46.7712,
  "pickup_lon": 23.6236,
  "dest_lat": 46.7750,
  "dest_lon": 23.6300
}
```

**Auto-sets:** `customer_id = current_user.id`

---

### List Deliveries (Role-based Filtering)

```http
GET /deliveries?status=pending
Authorization: Bearer <token>
```

**Response varies by role:**

- **Customer**: Sees only own deliveries
- **Dispatcher/Admin**: Sees all deliveries

---

### Get Delivery (Ownership Check)

```http
GET /deliveries/{delivery_id}
Authorization: Bearer <token>
```

**Ownership validation:**

- Customer can only view own delivery
- Dispatcher/Admin can view any delivery
- Returns 403 if customer tries to view others' delivery

---

## Dashboard Endpoints (Personalized per Role)

### Customer Dashboard

```http
GET /deliveries/dashboard/customer
Authorization: Bearer <token>
```

**Response:**

```json
{
  "user_id": 1,
  "user_role": "customer",
  "total_deliveries": 15,
  "pending": 2,
  "in_progress": 1,
  "delivered": 10,
  "failed": 2,
  "recent_deliveries": [
    {
      "id": 15,
      "status": "in_progress",
      "created_at": "2026-03-12T15:30:00",
      "estimated_distance_km": 8.5
    }
  ]
}
```

**Shows:**

- Personal delivery statistics
- Recent 5 deliveries
- Order status summary

---

### Dispatcher Dashboard

```http
GET /deliveries/dashboard/dispatcher
Authorization: Bearer <token>
```

**Response:**

```json
{
  "user_id": 2,
  "user_role": "dispatcher",
  "deliveries": {
    "total": 47,
    "pending": 12,
    "assigned": 8,
    "in_progress": 15,
    "delivered": 10,
    "failed": 2
  },
  "drones": {
    "total": 5,
    "available": 2,
    "busy": 3
  },
  "urgent_actions": {
    "pending_unassigned": [
      {
        "id": 30,
        "customer_id": 5,
        "distance_km": 15.3
      }
    ]
  }
}
```

**Shows:**

- All deliveries statistics
- Drone availability
- Unassigned deliveries that need action
- System health overview

---

## Role-Based Access Control Matrix

### Deliveries Management

| Action                 | Customer | Dispatcher | Admin |
| ---------------------- | -------- | ---------- | ----- |
| Create own delivery    | ✅       | ✅         | ✅    |
| View own delivery      | ✅       | ✅         | ✅    |
| View all deliveries    | ❌       | ✅         | ✅    |
| Assign drone           | ❌       | ✅         | ✅    |
| Update delivery status | ❌       | ✅         | ✅    |
| Customer Dashboard     | ✅       | ❌         | ❌    |
| Dispatcher Dashboard   | ❌       | ✅         | ✅    |

---

## Security Implementation

### Ownership Validation Function

```python
def can_view_delivery(user: User, delivery: Delivery) -> bool:
    """
    Determines if a user can view a delivery.
    - Admin/Dispatcher: can view anything
    - Customer: can view only own deliveries
    """
    if user.role in ["admin", "dispatcher"]:
        return True
    if user.role == "customer":
        return delivery.customer_id == user.id
    return False
```

### Database Constraints

```sql
ALTER TABLE deliveries
  ADD CONSTRAINT chk_customer_id
  CHECK (customer_id IS NOT NULL);

CREATE INDEX idx_delivery_customer
  ON deliveries(customer_id);
```

---

## Example Workflows

### Workflow 1: Customer Creates and Tracks Delivery

```bash
# 1. Customer registers
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "password": "Pass123!",
    "name": "John Customer",
    "role": "customer"
  }'
# Save token: TOKEN_CUSTOMER

# 2. Customer creates delivery
curl -X POST http://localhost:8000/deliveries \
  -H "Authorization: Bearer $TOKEN_CUSTOMER" \
  -H "Content-Type: application/json" \
  -d '{
    "pickup_lat": 46.7712,
    "pickup_lon": 23.6236,
    "dest_lat": 46.7750,
    "dest_lon": 23.6300
  }'
# Returns delivery with customer_id auto-set

# 3. Customer views own dashboard
curl -X GET http://localhost:8000/deliveries/dashboard/customer \
  -H "Authorization: Bearer $TOKEN_CUSTOMER"

# 4. Customer CANNOT access dispatcher dashboard
curl -X GET http://localhost:8000/deliveries/dashboard/dispatcher \
  -H "Authorization: Bearer $TOKEN_CUSTOMER"
# Returns 403 Forbidden
```

### Workflow 2: Dispatcher Manages All Deliveries

```bash
# 1. Dispatcher logs in
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "dispatcher@example.com",
    "password": "Pass123!"
  }'
# Save token: TOKEN_DISPATCHER

# 2. Dispatcher views all deliveries
curl -X GET http://localhost:8000/deliveries \
  -H "Authorization: Bearer $TOKEN_DISPATCHER"
# Sees all customers' deliveries

# 3. Dispatcher assigns drone to delivery
curl -X POST http://localhost:8000/deliveries/1/assign \
  -H "Authorization: Bearer $TOKEN_DISPATCHER"

# 4. Dispatcher views management dashboard
curl -X GET http://localhost:8000/deliveries/dashboard/dispatcher \
  -H "Authorization: Bearer $TOKEN_DISPATCHER"
# Sees system-wide statistics
```

---

## Best Practices

1. **Always validate ownership** - Check user.id matches resource owner
2. **Filter at database level** - Use WHERE clauses, not application filtering
3. **Log access** - Track who viewed/modified sensitive data
4. **Test permissions** - Ensure users can't access unauthorized resources
5. **Dashboard specific** - Each role sees only relevant dashboard
6. **Clear error messages** - Distinguish 403 (permission) from 404 (not found)

---

## Future Enhancements

- [ ] Ownership transfer (admin can change customer_id)
- [ ] Audit trail - log all access to deliveries
- [ ] Share delivery with other users (collaboration)
- [ ] Customer notifications on status changes
- [ ] Dispatcher work queue
- [ ] API rate limiting per role
