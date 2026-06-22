/\*\*

- DELIVERY SYSTEM - API ENDPOINTS DOCUMENTATION
- ============================================
-
- The delivery system is now fully integrated with the drone simulator.
- Deliveries can be created, automatically assigned to drones, and tracked.
  \*/

// ============================================
// 1. CREATE A NEW DELIVERY
// ============================================
POST /deliveries/
Content-Type: application/json

{
"pickup_lat": 46.7712, // Starting location (latitude)
"pickup_lon": 23.6236, // Starting location (longitude)
"dest_lat": 45.6528, // Destination (latitude)
"dest_lon": 25.6012 // Destination (longitude)
}

Response: 201
{
"id": 1,
"pickup_lat": 46.7712,
"pickup_lon": 23.6236,
"dest_lat": 45.6528,
"dest_lon": 25.6012,
"estimated_distance_km": 123.4, // server calculates straight-line distance pickup→dest
"estimated_duration_h": 2.06, // assuming 60 km/h
"status": "pending", // pending, assigned, in_progress, delivered, failed
"drone_id": null, // Will be assigned by auto-assign endpoint
"created_at": "2026-02-22T10:00:00",
"completed_at": null
}

// ============================================
// 2. AUTO-ASSIGN A DRONE TO DELIVERY
// ============================================
POST /deliveries/{delivery_id}/assign

Response: 200
{
"message": "Delivery assigned",
"delivery": {
"id": 1,
"status": "assigned",
"drone_id": 2, // Now assigned to drone #2
...
}
}

LOGIC:

- Finds all idle drones
- Calculates distance from drone position to pickup location
- Selects the closest drone
- Verifies drone has sufficient battery (>= 20%)
- Creates route: drone → pickup → destination
- Sets drone.status = "in_mission"
- Sets delivery.status = "assigned"

// ============================================
// 3. GET ALL DELIVERIES
// ============================================
GET /deliveries/
Optional: ?status=pending|assigned|in_progress|delivered|failed

Response: 200
[
{
"id": 1,
"status": "in_progress",
"drone_id": 2,
...
},
...
]

// ============================================
// 4. GET SPECIFIC DELIVERY
// ============================================
GET /deliveries/{delivery_id}

Response: 200
{
"id": 1,
"pickup_lat": 46.7712,
"pickup_lon": 23.6236,
"dest_lat": 45.6528,
"dest_lon": 25.6012,
"status": "delivered",
"drone_id": 2,
"created_at": "2026-02-22T10:00:00",
"completed_at": "2026-02-22T10:15:00"
}

// ============================================
// 5. UPDATE DELIVERY STATUS (Manual)
// ============================================
PATCH /deliveries/{delivery_id}/status?new_status=failed

Response: 200
{
"message": "Delivery status updated to failed"
}

// ============================================
// 6. DELIVERY STATISTICS

// ============================================
// 7. MISSION ENDPOINTS
// ============================================
// GET /missions/ – returns all missions (drone+delivery+timings). Each mission includes:
// id, drone_id, delivery_id, start_time, end_time, estimated_distance_km,
// estimated_duration_h, total_distance_km, progress_pct, remaining_km,
// remaining_duration_h, actual_duration_h, status
// GET /missions/stats – reports total, completed, avg estimated and actual durations
// ============================================
GET /deliveries/stats/summary

Response: 200
{
"total": 5,
"pending": 1,
"assigned": 1,
"in_progress": 1,
"delivered": 2,
"failed": 0
}

// ============================================
// AUTOMATIC WORKFLOW
// ============================================

1. Create delivery (status = pending)
   curl -X POST http://localhost:8000/deliveries/ \
    -H "Content-Type: application/json" \
    -d '{"pickup_lat":46.77,"pickup_lon":23.62,"dest_lat":45.65,"dest_lon":25.60}'

2. Auto-assign drone (status = assigned)
   curl -X POST http://localhost:8000/deliveries/1/assign

3. Simulator automatically:
   - Moves drone from current position → pickup
   - Picks up package (arrival at pickup location)
   - Moves drone from pickup → destination
   - Automatically marks delivery as "delivered" when drone reaches destination
   - Updates delivery.completed_at timestamp
   - Sets drone status back to "idle"

4. Monitor delivery status
   curl http://localhost:8000/deliveries/1

// ============================================
// DATABASE SCHEMA
// ============================================

CREATE TABLE deliveries (
id INTEGER PRIMARY KEY,
pickup_lat FLOAT NOT NULL,
pickup_lon FLOAT NOT NULL,
dest_lat FLOAT NOT NULL,
dest_lon FLOAT NOT NULL,
status VARCHAR(50) DEFAULT 'pending',
drone_id INTEGER FOREIGN KEY (REFERENCES drones.id),
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
completed_at DATETIME NULL
);

// ============================================
// FEATURES
// ============================================

✓ Automatic drone assignment (closest available)
✓ Battery verification (minimum 20%)
✓ Route planning (pickup → destination)
✓ Charging station integration (automatic refueling if needed)
✓ Automatic delivery completion on arrival
✓ Delivery status tracking
✓ Timestamps for created and completed deliveries
✓ Statistics and reporting

// ============================================
// INTEGRATION WITH DRONE SIMULATOR
// ============================================

When the drone reaches destination (dest_latitude, dest_longitude):

1. Simulator calls mark_delivery_as_delivered(delivery_id)
2. Delivery status changes from "in_progress" to "delivered"
3. completed_at timestamp is set
4. Drone status returns to "idle"
5. Drone position is set to final destination

\*/
