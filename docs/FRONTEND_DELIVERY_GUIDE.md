# 🚁 Frontend Delivery System - Documentation

## Overview

The frontend has been updated to include a complete delivery management system with tabbed navigation between the drone map and delivery management.

## 📱 New Components

### 1. **DeliveryForm.jsx** (`components/DeliveryForm.jsx`)

Creates new deliveries with pickup and destination coordinates.

**Features:**

- Input fields for pickup location (latitude/longitude)
- Input fields for destination location (latitude/longitude)
- Form validation
- Error/success notifications
- Callback to parent component on successful creation

**Usage:**

```javascript
<DeliveryForm onDeliveryCreated={handleDeliveryCreated} />
```

### 2. **DeliveryList.jsx** (`components/DeliveryList.jsx`)

Displays all deliveries with real-time status tracking and management.

**Features:**

- Display all deliveries in a table format
- Filter by status (pending, assigned, in_progress, delivered, failed)
- Statistics dashboard (total, pending, assigned, etc.)
- Auto-refresh every 2 seconds
- One-click auto-assign for pending deliveries
- Status color indicators
- Timestamps for creation and completion

**Status Colors:**

- 🟡 **Pending** - waiting for drone assignment
- 🔵 **Assigned** - drone has been selected
- 🔷 **In Progress** - drone is currently delivering
- 🟢 **Delivered** - delivery completed
- 🔴 **Failed** - delivery could not be completed

### 3. **Updated App.js**

Main application component with tabbed interface.

**Features:**

- Two main tabs:
  1. **🛰️ Drone Map** - Original drone map and routing
  2. **📦 Deliveries** - Delivery management system
- Tab state management
- Automatic refresh trigger for deliveries

## 🎨 Styling Updates

Added to `App.css`:

- Input field focus states with proper visual feedback
- Responsive grid layout for delivery statistics
- Hover effects on table rows
- Mobile-responsive design
- Bootstrap-inspired color scheme

## 🔄 Workflow

### Creating and Managing Deliveries

#### Step 1: Create Delivery

1. Click on **"📦 Deliveries"** tab
2. Fill in the delivery form:
   - **Pickup Latitude** (e.g., 46.7712)
   - **Pickup Longitude** (e.g., 23.6236)
   - **Destination Latitude** (e.g., 45.6528)
   - **Destination Longitude** (e.g., 25.6012)
3. Click **"📦 Create delivery"** button
4. Delivery is created with status `pending`

#### Step 2: Auto-Assign Drone

1. View the delivery in the **DeliveryList**
2. Click the **"🚁 Assign"** button for the pending delivery
3. System automatically:
   - Finds the closest available drone
   - Verifies battery level (minimum 20%)
   - Creates route: drone → pickup → destination
   - Updates delivery status to `assigned`

#### Step 3: Monitor Progress

1. Delivery status changes automatically:
   - `pending` → `assigned` (when drone is assigned)
   - `assigned` → `in_progress` (when drone starts moving)
   - `in_progress` → `delivered` (when drone reaches destination)
2. Timestamps are recorded for creation and completion
3. Real-time updates every 2 seconds

#### Step 4: Verify Completion

1. Check delivery status in the list
2. View:
   - Pickup and destination coordinates
   - Assigned drone ID
   - Creation timestamp
   - Completion timestamp

## 📊 DeliveryList Features

### Statistics Dashboard

Shows real-time counts:

- **Total** - all deliveries
- **⏳ Pending** - waiting for assignment
- **📍 Assigned** - drone selected, waiting to start
- **🚁 In Progress** - currently being delivered
- **✅ Delivered** - successfully completed
- **❌ Failed** - could not complete

### Filtering

Click filter buttons to view deliveries by status:

- **All** - show all deliveries
- Per-status filters for focused view

### Table Columns

1. **ID** - unique delivery identifier
2. **Pickup** - pickup location (lat, lon)
3. **Destination** - destination location (lat, lon)
4. **Status** - current delivery status (color-coded)
5. **Drone** - assigned drone ID or "-"
6. **Created** - creation timestamp
7. **Finished** - completion timestamp or "-"
8. **Actions** - available actions (Assign button for pending)

## 🔌 API Integration

The frontend communicates with the backend via these endpoints:

### Create Delivery

```
POST /deliveries/
```

Request body:

```json
{
  "pickup_lat": 46.7712,
  "pickup_lon": 23.6236,
  "dest_lat": 45.6528,
  "dest_lon": 25.6012
}
```

### Get All Deliveries

```
GET /deliveries/
GET /deliveries/?status={status}
```

### Auto-Assign Delivery

```
POST /deliveries/{id}/assign
```

### Get Statistics

```
GET /deliveries/stats/summary
```

## 🚀 How to Run

### Terminal 1 - Backend

```powershell
cd C:\Users\Denisa\OneDrive\Desktop\Facultate\Licenta
.\venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload --port 8000
```

### Terminal 2 - Frontend

```powershell
cd C:\Users\Denisa\OneDrive\Desktop\Facultate\Licenta\frontend
npm start
```

### Access

- **Frontend**: http://localhost:3001 (or port 3000 if 3001 is taken)
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

## 📋 Example Scenarios

### Scenario 1: Quick Delivery

1. Create delivery from Cluj-Napoca to Brașov
2. Click Assign → System finds closest drone
3. Monitor real-time progress on DeliveryList
4. See ✅ status and completion time

### Scenario 2: Multiple Deliveries

1. Create 3-4 deliveries to different locations
2. Assign each one
3. Watch them all progress simultaneously
4. Filter by status to see in-progress deliveries
5. Check statistics dashboard

### Scenario 3: Monitor with Drone Map

1. Create delivery in Livrări tab
2. Assign to drone
3. Switch to 🛰️ Drone Map tab
4. See drone position update in real-time
5. Return to 📦 Deliveries for delivery details

## 🐛 Troubleshooting

### "Backend-ul nu răspunde"

- Ensure backend is running on port 8000
- Check that uvicorn started successfully
- Verify proxy in `frontend/package.json` is set to `http://127.0.0.1:8000`

### Cannot assign delivery

- Ensure at least one drone is idle
- Check drone battery level (minimum 20%)
- Verify pickup and destination are accessible

### Real-time updates not showing

- Check browser console for API errors
- Ensure WebSocket/polling is working
- Refresh page if needed

## 📝 File Structure

```
frontend/src/
├── App.js                          (Main app with tabs)
├── App.css                         (Styling)
├── components/
│   ├── DroneMap.jsx               (Original drone map)
│   ├── DeliveryForm.jsx           (NEW - Create deliveries)
│   ├── DeliveryList.jsx           (NEW - Manage deliveries)
│   └── ...other components
├── assets/
├── index.js
└── ...
```

## 🎯 Key Improvements

✅ Seamless tabbed interface between drone tracking and delivery management
✅ Real-time delivery status updates
✅ One-click automatic drone assignment
✅ Comprehensive statistics and filtering
✅ User-friendly form validation
✅ Color-coded status indicators
✅ Responsive design for mobile devices
✅ Integrated with backend delivery system

## 🔮 Future Enhancements

- Map visualization of delivery routes in separate map
- Delivery history and analytics
- Estimated delivery time calculation
- Customer notifications
- Delivery priority levels
- Batch delivery creation
- Delivery edit/cancel functionality
