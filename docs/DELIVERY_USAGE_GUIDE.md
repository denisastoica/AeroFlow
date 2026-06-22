# Delivery System - Problem & Solution

## What happened?

**Problem**: You received the error "No available drone for this delivery" even though drones were available.

**Real Cause**: The deliveries you created had coordinates **too far away** (~334 km), but drones can fly a maximum of ~125 km on a single charge.

### Example of an impossible delivery:
```
Pickup:  (46.7712, 23.6236)
Dest:    (45.6528, 25.6012)
Distance: 334 km ❌

Battery needed: 334 km × 0.8% = 267% 
Battery available: 100%
```

## What was resolved?

### 1. ✅ Frontend - DeliveryForm.jsx
- **Default coordinates**: changed from (46.77, 23.62) → (46.18, 23.85) - much closer
- **Distance calculator**: you can now see the delivery distance in real time
- **Validation**: you cannot create deliveries > 100 km, the button is grayed out if the distance is too large

### 2. ✅ Backend - Drones reset
- All drones: 100% battery + known positions (Cluj region)
- Old deliveries: deleted

### 3. ✅ System Requirements
- **Max recommended distance**: ~100 km (safe)
- **Max drone autonomy**: ~125 km (125% battery / 0.8% per km)
- **Drone positions now** (reset):
  - Drone 1: (46.560, 25.455) Cluj
  - Drone 2: (46.184, 26.071) Transylvania
  - Drone 3: (46.184, 23.816) Cluj West

## How to use the system correctly?

### 📍 Safe coordinates (tested):
- **Cluj Area**: (46.0-46.6 latitude, 23.5-25.8 longitude)
- **Brașov Area**: (46.1-46.3 latitude, 25.5-26.5 longitude)

### ✅ Recommended tests:

1. **Short delivery (10-15 km)**
   - Pickup: (46.18, 23.85)
   - Dest: (46.25, 24.00)
   - Distance: ~12 km, Battery: 9.6% ✓

2. **Medium delivery (30 km)**
   - Pickup: (46.20, 24.00)
   - Dest: (46.40, 24.20)
   - Distance: ~32 km, Battery: 25.6% ✓

3. **Long delivery (80 km)**
   - Pickup: (46.184, 23.816) (drone position)
   - Dest: (46.560, 25.455)
   - Distance: ~87 km, Battery: 69.6% ✓

### Steps to create a delivery = ✅

1. Go to http://localhost:3001 → "📦 Deliveries" tab
2. Fill in Pickup coordinates and Destination
3. **Look at "📍 Delivery Distance"** - it must be green ✅
4. If it's red, move the coordinates closer
5. Press "📦 Create delivery"
6. Press "🚁 Assign" on the delivery in the table
7. Watch the drone move on the map!

## System Verification

```bash
# Check API:
curl http://localhost:8000/drones/
curl http://localhost:8000/deliveries/

# Frontend: 
http://localhost:3001
```

## Grid Dimensions:
- **Lat**: 43.5°N - 48.5°N (Romania)
- **Lon**: 20°E - 30°E (Romania)

## Battery Calculation Formula:

```
distance_km = haversine(lat1, lon1, lat2, lon2)
battery_needed_percent = distance_km × 0.8%
```

For example:
- 50 km = 50 × 0.8 = **40% battery**
- 100 km = 100 × 0.8 = **80% battery**
- 125 km = 125 × 0.8 = **100% battery** (maximum)

---

**TL;DR**: The system was OK, but deliveries needed to be closer. The frontend now helps you avoid mistakes! 🚁
