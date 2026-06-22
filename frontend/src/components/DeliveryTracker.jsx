import React, { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Circle,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useDeliveryTracking } from "../hooks/useDeliveryTracking";
import { chargingAPI } from "../services/api";
import ProofOfDelivery from "./ProofOfDelivery";
import { formatBackendDateTime } from "../utils/datetime";

import droneIdle from "../assets/icons/drone-icon.png";
import droneMission from "../assets/icons/drone-green.png";
import droneCharging from "../assets/icons/drone-yellow.png";

const getActiveSegment = (routePath, routeIndex, stations) => {
  if (!Array.isArray(routePath) || routePath.length < 2) return [];
  
  const startIdx = Math.max(0, Number(routeIndex || 0));
  if (startIdx >= routePath.length) return [];
  
  const slicedPath = routePath.slice(startIdx);
  
  let endIdx = slicedPath.length;
  for (let i = 1; i < slicedPath.length; i++) {
    const [lat, lon] = slicedPath[i];
    
        const isAtStation = Array.isArray(stations) && stations.some(station => {
      const sLat = station.latitude || station.lat;
      const sLon = station.longitude || station.lon;
      if (sLat == null || sLon == null) return false;
      
      const dLat = lat - sLat;
      const dLon = lon - sLon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon) * 111.0;
      return dist < 0.1;
    });
    
    if (isAtStation) {
      endIdx = i + 1;
      break;
    }
  }
  
  return slicedPath.slice(0, endIdx);
};

function makeDroneIconTracker(status) {
  let imgUrl = droneIdle;
  if (status === "in_mission" || status === "going_to_charging") imgUrl = droneMission;
  else if (status === "charging") imgUrl = droneCharging;
  return new L.DivIcon({
    className: "tracker-drone-marker",
    html: `<div style="position:relative;width:44px;height:44px;">
      <div class="tracker-drone-pulse"></div>
      <img src="${imgUrl}" width="44" height="44" alt="" draggable="false" style="
        position:relative;z-index:2;display:block;
        filter:drop-shadow(0 3px 6px rgba(0,0,0,0.4));" />
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  });
}

const pickupIcon = new L.DivIcon({
  className: "tracker-location-pin",
  html: `<div style="
    width:24px;height:24px;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);
    background:linear-gradient(135deg,#33d69f,#22b784);
    border:2px solid rgba(255,255,255,0.9);
    box-shadow:0 3px 14px rgba(51,214,159,0.5),0 0 20px rgba(51,214,159,0.2);
    display:flex;align-items:center;justify-content:center;">
    <span style="transform:rotate(45deg);font-size:11px;line-height:1;color:#fff;font-weight:700;">P</span>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -26],
});

const destIcon = new L.DivIcon({
  className: "tracker-location-pin",
  html: `<div style="
    width:24px;height:24px;border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);
    background:linear-gradient(135deg,#ff4d6d,#e63956);
    border:2px solid rgba(255,255,255,0.9);
    box-shadow:0 3px 14px rgba(255,77,109,0.5),0 0 20px rgba(255,77,109,0.2);
    display:flex;align-items:center;justify-content:center;">
    <span style="transform:rotate(45deg);font-size:11px;line-height:1;color:#fff;font-weight:700;">D</span>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -26],
});

const priorityColors = {
  normal: { main: "#7c5cff", bg: "rgba(124,92,255,0.08)", border: "rgba(124,92,255,0.25)" },
  urgent: { main: "#ffd166", bg: "rgba(255,209,102,0.10)", border: "rgba(255,209,102,0.35)" },
  emergency: { main: "#ff4d6d", bg: "rgba(255,77,109,0.10)", border: "rgba(255,77,109,0.35)" },
};

const stationIcon = new L.DivIcon({
  className: "tracker-station-marker",
  html: `<div style="
    width:26px;height:26px;border-radius:50%;
    background:linear-gradient(135deg,#ffd166,#ffb347);
    border:2px solid rgba(255,255,255,0.85);
    box-shadow:0 2px 8px rgba(255,209,102,0.5);
    display:flex;align-items:center;justify-content:center;
    font-size:14px;line-height:1;">⚡</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -16],
});

const statusSteps = [
  { key: "pending", label: "Created", icon: "1" },
  { key: "assigned", label: "Assigned", icon: "2" },
  { key: "picking_up", label: "Pickup", icon: "3" },
  { key: "in_transit", label: "Transit", icon: "4" },
  { key: "delivered", label: "Delivered", icon: "5" },
];

function getStatusIndex(status) {
  if (status === "failed" || status === "cancelled") return -1;
  const idx = statusSteps.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

function formatCoords(lat, lon) {
  if (lat == null || lon == null) return "Unavailable";
  return `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
}

function formatStatusLabel(status) {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ");
}

const FAILURE_REASON_LABELS = {
  unsafe_dropoff_weather: "Unsafe Drop-off: Dangerous weather at destination",
  unsafe_dropoff_low_battery: "Unsafe Drop-off: Battery below critical margin",
  unsafe_dropoff_position_mismatch: "Unsafe Drop-off: Coordinate mismatch at destination",
};

function formatFailureReason(reason) {
  if (!reason) return "Unknown reason";
  return FAILURE_REASON_LABELS[reason] || reason.replace(/_/g, " ");
}

function FitBoundsTracker({ points }) {
  const map = useMap();

  useEffect(() => {
    const validPoints = points
      .filter(Boolean)
      .map((p) => [Number(p[0]), Number(p[1])])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

    if (validPoints.length < 2) return;

    const bounds = L.latLngBounds(validPoints);
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [45, 45],
        maxZoom: 13,
        animate: true,
      });
    }
  }, [map, JSON.stringify(points)]);

  return null;
}

function MapFixer() {
  const map = useMap();
  useEffect(() => {
        const delays = [50, 150, 300, 500, 800];
    const timers = delays.map((delay, i) =>
      setTimeout(() => {
        try {
          map.invalidateSize({ reset: i >= 3 });
        } catch (_) {}
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [map]);
  return null;
}

function AnimatedDroneMarker({ lat, lon, status, pathSegment, icon, children }) {
  const markerRef = useRef(null);
  const initialPosRef = useRef([lat, lon]);
  const animRef = useRef(null);

      const segmentsRef  = useRef([]);
  const toPosRef     = useRef([lat, lon]);
  const velRef       = useRef([0, 0]);
  const tickStartRef = useRef(null);
  const tickDurRef   = useRef(500);
  const prevTsRef    = useRef(null);
  const TICK_MS = 500;
  const MAX_EXTRAP_MS = 0;
  const SNAP_THRESHOLD_KM = 15.0;

  const segKm = (a, b) => {
    const dLat = (b[0] - a[0]) * 111.32;
    const dLon = (b[1] - a[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  };

  const getDisplayPos = (now) => {
    const segs = segmentsRef.current;
    if (!tickStartRef.current || segs.length === 0) return toPosRef.current.slice();
    const elapsed = now - tickStartRef.current;
    const tickDur = tickDurRef.current;
    if (elapsed <= tickDur) {
      const t = elapsed / tickDur;
      for (let i = 0; i < segs.length; i++) {
        if (t <= segs[i].endFrac || i === segs.length - 1) {
          const { from, to, startFrac, endFrac } = segs[i];
          const span = endFrac - startFrac;
          const segT = span > 1e-9 ? Math.min(1, (t - startFrac) / span) : 1;
          return [from[0] + (to[0] - from[0]) * segT, from[1] + (to[1] - from[1]) * segT];
        }
      }
      return toPosRef.current.slice();
    }
    const extraMs = Math.min(elapsed - tickDur, MAX_EXTRAP_MS);
    return [
      toPosRef.current[0] + velRef.current[0] * extraMs,
      toPosRef.current[1] + velRef.current[1] * extraMs,
    ];
  };

  useEffect(() => {
    const animate = (ts) => {
      if (tickStartRef.current !== null) {
        const [iLat, iLon] = getDisplayPos(ts);
        try { markerRef.current?.setLatLng([iLat, iLon]); } catch (_) {}
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; } };
  }, []);

  useEffect(() => {
    if (!lat || !lon) return;
    const now = performance.now();

        const dynamicDurMs = TICK_MS;
    prevTsRef.current = now;

    const curPos = getDisplayPos(now);

        if (segKm(curPos, [lat, lon]) > SNAP_THRESHOLD_KM) {
      segmentsRef.current  = [{ from: [lat, lon], to: [lat, lon], startFrac: 0, endFrac: 1 }];
      toPosRef.current     = [lat, lon];
      velRef.current       = [0, 0];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
      try { markerRef.current?.setLatLng([lat, lon]); } catch (_) {}
      return;
    }

    const isMoving = status === 'in_mission' || status === 'going_to_charging';
    if (!isMoving) {
      segmentsRef.current  = [{ from: [lat, lon], to: [lat, lon], startFrac: 0, endFrac: 1 }];
      toPosRef.current     = [lat, lon];
      velRef.current       = [0, 0];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
      try { markerRef.current?.setLatLng([lat, lon]); } catch (_) {}
      return;
    }

    if (pathSegment && pathSegment.length >= 2) {
                        try { markerRef.current?.setLatLng(pathSegment[0]); } catch (_) {}

      const kms = [];
      let totalKm = 0;
      for (let i = 0; i < pathSegment.length - 1; i++) {
        const k = segKm(pathSegment[i], pathSegment[i + 1]);
        kms.push(k);
        totalKm += k;
      }
      if (totalKm < 1e-6) {
        segmentsRef.current  = [{ from: [lat, lon], to: [lat, lon], startFrac: 0, endFrac: 1 }];
        toPosRef.current     = [lat, lon];
        velRef.current       = [0, 0];
        tickDurRef.current   = dynamicDurMs;
        tickStartRef.current = now;
        return;
      }
      const segs = [];
      let frac = 0;
      for (let i = 0; i < pathSegment.length - 1; i++) {
        const segFrac = kms[i] / totalKm;
        const from = pathSegment[i].slice();
        const to   = pathSegment[i + 1].slice();
        segs.push({ from, to, startFrac: frac, endFrac: frac + segFrac });
        frac += segFrac;
      }
      const lastSeg   = segs[segs.length - 1];
      const lastDurMs = (kms[kms.length - 1] / totalKm) * dynamicDurMs;
      velRef.current = [
        (lastSeg.to[0] - lastSeg.from[0]) / Math.max(lastDurMs, 1),
        (lastSeg.to[1] - lastSeg.from[1]) / Math.max(lastDurMs, 1),
      ];
      segmentsRef.current  = segs;
      toPosRef.current     = [lat, lon];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
    } else {
            segmentsRef.current  = [{ from: curPos, to: [lat, lon], startFrac: 0, endFrac: 1 }];
      toPosRef.current     = [lat, lon];
      velRef.current       = [(lat - curPos[0]) / dynamicDurMs, (lon - curPos[1]) / dynamicDurMs];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
    }
  }, [lat, lon, status, pathSegment]);

  return (
    <Marker ref={markerRef} position={initialPosRef.current} icon={icon}>
      {children}
    </Marker>
  );
}

export default function DeliveryTracker({ deliveryId, onClose }) {
  const { tracking, loading, error } = useDeliveryTracking(deliveryId);
  const [stations, setStations] = useState([]);
  const [showPoD, setShowPoD] = useState(false);

  useEffect(() => {
    chargingAPI.getStations()
      .then((res) => setStations(res.data?.stations || []))
      .catch(() => { });
  }, []);

  if (!deliveryId) return null;

  if (loading && !tracking) {
    return (
      <div className="tracker">
        <div className="tracker__header">
          <h3 style={{ margin: 0 }}>Live Tracking</h3>
          {onClose && <button onClick={onClose} className="tracker__close">✕</button>}
        </div>
        <div style={{ padding: 32, textAlign: "center", color: "#adb5bd" }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>🚁</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Loading tracking data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tracker">
        <div className="tracker__header">
          <h3 style={{ margin: 0 }}>Live Tracking</h3>
          {onClose && <button onClick={onClose} className="tracker__close">✕</button>}
        </div>
        <div style={{ padding: 32, color: "#ff4d6d", textAlign: "center" }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>🚫</div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{error}</div>
          <div className="subtle" style={{ marginTop: 6 }}>Check your internet connection or try again later.</div>
        </div>
      </div>
    );
  }

  if (!tracking) {
    return (
      <div className="tracker">
        <div className="tracker__header">
          <h3 style={{ margin: 0 }}>Live Tracking</h3>
          {onClose && <button onClick={onClose} className="tracker__close">✕</button>}
        </div>
        <div style={{ padding: 32, textAlign: "center", color: "#adb5bd" }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>📦</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>No tracking data found for this delivery.</div>
        </div>
      </div>
    );
  }

  const { drone, mission } = tracking;
  const weather = tracking.weather || null;
  const pColor = priorityColors[tracking.priority] || priorityColors.normal;
  const statusIdx = getStatusIndex(tracking.status);
  const isFailed = tracking.status === "failed" || tracking.status === "cancelled";
  const isDelivered = tracking.status === "delivered";
  const isActive = ["assigned", "picking_up", "picked_up", "in_transit", "in_progress"].includes(tracking.status);

    const centerLat = drone?.latitude || (tracking.pickup_lat && tracking.dest_lat ? (tracking.pickup_lat + tracking.dest_lat) / 2 : 46.77);
  const centerLon = drone?.longitude || (tracking.pickup_lon && tracking.dest_lon ? (tracking.pickup_lon + tracking.dest_lon) / 2 : 23.62);

    let etaMinutes = null;
  if (mission?.remaining_duration_h) {
    etaMinutes = Math.ceil(mission.remaining_duration_h * 60);
  }

    const chargesDone = drone?.charge_count || 0;
  let estChargesLeft = 0;
  if (mission?.remaining_km != null && drone?.battery != null) {
    const maxRangeKm = 120;
    const currentRangeKm = (drone.battery / 100) * maxRangeKm;
    const deficit = mission.remaining_km - currentRangeKm;
    if (deficit > 0) estChargesLeft = Math.ceil(deficit / maxRangeKm);
  }

    const phaseLabels = {
    planned: "Waiting for launch",
    en_route_pickup: "Flying to pickup",
    at_pickup: "At pickup point",
    en_route_delivery: "Flying to destination",
    in_progress: "In flight",
    charging: "Charging at station",
  };
  const missionPhase = mission?.status ? (phaseLabels[mission.status] || mission.status) : null;
  const routePointCount = Array.isArray(drone?.route_path) ? drone.route_path.length : 0;
  const routeSummary = mission?.remaining_km != null
    ? `${mission.remaining_km.toFixed(1)} km remaining`
    : routePointCount > 1
      ? `${routePointCount} plotted waypoints`
      : "Direct route between pickup and destination";
  const pickupSummary = formatCoords(tracking.pickup_lat, tracking.pickup_lon);
  const destinationSummary = formatCoords(tracking.dest_lat, tracking.dest_lon);
  const dronePositionSummary = drone?.latitude != null && drone?.longitude != null
    ? formatCoords(drone.latitude, drone.longitude)
    : "Awaiting live position";

  const routePath = Array.isArray(drone?.route_path)
    ? drone.route_path
        .map((p) => [Number(p[0]), Number(p[1])])
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];

  const hasDronePosition =
    drone?.latitude != null &&
    drone?.longitude != null &&
    Number.isFinite(Number(drone.latitude)) &&
    Number.isFinite(Number(drone.longitude));

  const dronePosition = hasDronePosition
    ? [Number(drone.latitude), Number(drone.longitude)]
    : null;

  return (
    <div className="tracker">
            <div className="tracker__slim-header" style={{ borderTop: `3px solid ${pColor.main}` }}>
        <div className="tracker__slim-top">
          <div className="tracker__slim-identity">
            <h3 style={{ margin: 0, fontSize: 18 }}>#{tracking.delivery_id}</h3>
            <span className="tracker__slim-status" style={{ background: `${pColor.main}15`, color: pColor.main }}>
              {formatStatusLabel(tracking.status)}
            </span>
          </div>

          <div className="tracker__slim-stepper">
            {statusSteps.map((step, i) => {
              const isCompleted = statusIdx >= i;
              const isCurrent = statusIdx === i;
              const isPast = statusIdx > i;
              return (
                <React.Fragment key={step.key}>
                  <div className={`tracker__mini-step ${isCurrent ? 'active' : ''} ${isPast ? 'past' : ''}`}>
                    <div className="tracker__mini-dot" style={{
                      background: isCompleted ? pColor.main : "rgba(255,255,255,0.1)",
                      boxShadow: isCurrent ? `0 0 10px ${pColor.main}` : 'none'
                    }}>
                      {isPast ? "✓" : ""}
                    </div>
                    <span className="tracker__mini-label">{step.label}</span>
                  </div>
                  {i < statusSteps.length - 1 && (
                    <div className="tracker__mini-line" style={{
                      background: isPast ? pColor.main : "rgba(255,255,255,0.1)"
                    }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {onClose && <button onClick={onClose} className="tracker__close-minimal">✕</button>}
        </div>
      </div>

      {isFailed && (
        <div className="tracker__failed">
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Delivery Failed</div>
          {tracking.failure_reason && (
            <div style={{ marginTop: 8, fontSize: 14, color: "rgba(255,255,255,0.8)" }}>
              Reason: <strong>{formatFailureReason(tracking.failure_reason)}</strong>
            </div>
          )}

                    {tracking.dropoff_safety_status === "failed" && (
            <div style={{
              marginTop: 16,
              background: "rgba(255,77,109,0.08)",
              border: "1px solid rgba(255,77,109,0.2)",
              borderRadius: 8,
              padding: 12,
              textAlign: "left",
              width: "100%",
              maxWidth: 320
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, color: "#ff4d6d" }}>🛡️ Unsafe Drop-off Blocked</span>
                <span style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  background: "rgba(255,77,109,0.15)",
                  color: "#ff4d6d"
                }}>Blocked</span>
              </div>
              <div style={{ fontSize: 11, display: "grid", gap: 4 }}>
                <div>☁️ Weather: <strong style={{
                  color: tracking.dropoff_weather_safe === "safe"
                    ? "var(--success)"
                    : tracking.dropoff_weather_safe === "warning"
                      ? "var(--warning)"
                      : "var(--danger)"
                }}>
                  {tracking.dropoff_weather_safe === "safe"
                    ? "Safe"
                    : tracking.dropoff_weather_safe === "warning"
                      ? "Caution (At Risk)"
                      : "Unsafe"
                  }
                </strong></div>
                <div>🔋 Battery at arrival: <strong style={{ color: tracking.dropoff_battery_pct >= 12.0 ? "var(--success)" : "var(--danger)" }}>{tracking.dropoff_battery_pct ? `${tracking.dropoff_battery_pct.toFixed(0)}%` : "N/A"}</strong></div>
                <div>📍 Distance to destination: <strong style={{ color: tracking.dropoff_distance_m <= 100.0 ? "var(--success)" : "var(--danger)" }}>{tracking.dropoff_distance_m != null ? `${tracking.dropoff_distance_m.toFixed(0)} m` : "N/A"}</strong></div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--danger)", fontWeight: 700 }}>
                ⚠️ Safety check blocked: {tracking.dropoff_safety_reason || "weather unsafe"}
              </div>
            </div>
          )}
        </div>
      )}

            {isActive && (
        <div className="tracker__map">
          <MapContainer
            center={(!isNaN(centerLat) && !isNaN(centerLon)) ? [centerLat, centerLon] : [46.77, 23.62]}
            zoom={11}
            style={{ height: "100%", width: "100%" }}
            zoomControl={false}
          >
            <MapFixer />
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            />

            {(() => {
              const activeSegment = getActiveSegment(routePath, tracking.drone?.route_index || 0, stations);
              const displayPath = activeSegment.length >= 2 ? activeSegment : routePath;
              return (
                <>
                  {tracking.pickup_lat != null && tracking.dest_lat != null && (
                    <FitBoundsTracker
                      points={[
                        [tracking.pickup_lat, tracking.pickup_lon],
                        [tracking.dest_lat, tracking.dest_lon],
                        dronePosition,
                        ...displayPath,
                      ]}
                    />
                  )}

                                    {tracking.pickup_lat != null && tracking.dest_lat != null && (
                    <Polyline
                      positions={[
                        [tracking.pickup_lat, tracking.pickup_lon],
                        [tracking.dest_lat, tracking.dest_lon],
                      ]}
                      pathOptions={{ color: "rgba(255,255,255,0.08)", weight: 1, dashArray: "4 6" }}
                    />
                  )}

                                    {displayPath.length >= 2 && (
                    <Polyline
                      positions={displayPath}
                      pathOptions={{
                        color: pColor.main,
                        weight: 4,
                        opacity: 0.7,
                        dashArray: "10, 10",
                        lineCap: "round",
                      }}
                    />
                  )}
                </>
              );
            })()}

                        {tracking.pickup_lat != null && tracking.pickup_lon != null && (
              <Marker position={[tracking.pickup_lat, tracking.pickup_lon]} icon={pickupIcon}>
                <Popup className="tracker-popup">
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Pickup Point</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{tracking.pickup_address || "Pickup"}</div>
                </Popup>
              </Marker>
            )}

                        {tracking.dest_lat != null && tracking.dest_lon != null && (
              <>
                <Marker position={[tracking.dest_lat, tracking.dest_lon]} icon={destIcon}>
                  <Popup className="tracker-popup">
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Destination</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{tracking.dest_address || "Destination"}</div>
                  </Popup>
                </Marker>

                                <Circle
                  center={[tracking.dest_lat, tracking.dest_lon]}
                  radius={400}
                  pathOptions={{ color: "#ff4d6d", fillColor: "#ff4d6d", fillOpacity: 0.08, weight: 1, opacity: 0.3 }}
                />
              </>
            )}

                        {stations.map((s, i) => (
              <Marker key={`station-${i}`} position={[s.lat, s.lon]} icon={stationIcon}>
                <Popup className="tracker-popup">
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>Charging station</div>
                </Popup>
              </Marker>
            ))}

                        {drone?.latitude && drone?.longitude && (
              <>
              <AnimatedDroneMarker lat={drone.latitude} lon={drone.longitude} status={drone.status} pathSegment={drone.path_segment} icon={makeDroneIconTracker(drone.status || "in_mission")}>
                  <Popup className="tracker-popup">
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                      {drone.name || formatDroneName(drone.id)}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 12 }}>
                      <div>Battery</div>
                      <div style={{
                        fontWeight: 600,
                        color: drone.battery <= 15 ? "#ff4d6d" : drone.battery <= 30 ? "#ffd166" : "#33d69f"
                      }}>{drone.battery}%</div>
                      {mission && <>
                        <div>Progress</div>
                        <div style={{ fontWeight: 600 }}>{mission.progress_pct?.toFixed(1)}%</div>
                      </>}
                      {mission?.remaining_km != null && <>
                        <div>Remaining</div>
                        <div style={{ fontWeight: 600 }}>{mission.remaining_km.toFixed(1)} km</div>
                      </>}
                    </div>
                  </Popup>
                </AnimatedDroneMarker>
                <Circle
                  center={[drone.latitude, drone.longitude]}
                  radius={350}
                  pathOptions={{
                    color: pColor.main,
                    fillColor: pColor.main,
                    fillOpacity: 0.06,
                    weight: 1.5,
                    opacity: 0.4,
                    dashArray: "4 4",
                  }}
                />
              </>
            )}
          </MapContainer>

                    {drone?.latitude && drone?.longitude && (
            <div className="tracker__map-badge">
              <div className="tracker__map-badge-bat">
                <span style={{
                  color: drone.battery <= 15 ? "var(--danger)" : drone.battery <= 30 ? "var(--warning)" : "#33d69f"
                }}>BAT {drone.battery}%</span>
              </div>
              {mission?.progress_pct != null && (
                <div className="tracker__map-badge-progress">
                  <div className="tracker__map-badge-bar">
                    <div style={{ width: `${mission.progress_pct}%`, background: pColor.main }} />
                  </div>
                  <span>{mission.progress_pct.toFixed(0)}%</span>
                </div>
              )}
            </div>
          )}

                    {etaMinutes !== null && (
            <div className="tracker__eta-badge-map">
              <div className="tracker__eta-icon">🕒</div>
              <div className="tracker__eta-content">
                <span className="label">ETA</span>
                <span className="value">{etaMinutes < 1 ? "<1" : etaMinutes} min</span>
              </div>
            </div>
          )}

                    <button
            className="tracker__recenter-btn"
            onClick={() => {
                                                      }}
            title="Recenter Map"
          >
            🎯
          </button>
        </div>
      )}

            {isActive && (
        <>
          <div className="tracker__support-row">
          <div className="tracker__support-card">
            <div className="label">Pickup</div>
            <div className="value truncate">{tracking.pickup_address || pickupSummary}</div>
          </div>
          <div className="tracker__support-card">
            <div className="label">Destination</div>
            <div className="value truncate">{tracking.dest_address || destinationSummary}</div>
          </div>
          <div className="tracker__support-card">
            <div className="label">Drone Position</div>
            <div className="value">{dronePositionSummary}</div>
          </div>
          <div className="tracker__support-card">
            <div className="label">Distance Left</div>
            <div className="value">{mission?.remaining_km ? `${mission.remaining_km.toFixed(1)} km` : '—'}</div>
          </div>
          <div className="tracker__support-card">
            <div className="label">Status</div>
            <div className="value" style={{ color: pColor.main }}>{formatStatusLabel(tracking.status)}</div>
          </div>
        </div>

                <div style={{
          margin: "16px 20px 0 20px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: 14,
          animation: "fadeIn 0.3s ease"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--primary)" }}>
              🛡️ Pre-Arrival Drop-off Check
            </span>
            <span style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 800,
              textTransform: "uppercase",
              background: (weather && ["storm", "rain", "heavy_rain", "snow"].includes(weather.condition)) || (drone && drone.battery < 15) ? "rgba(255,77,109,0.15)" : "rgba(106,228,255,0.15)",
              color: (weather && ["storm", "rain", "heavy_rain", "snow"].includes(weather.condition)) || (drone && drone.battery < 15) ? "#ff4d6d" : "var(--accent)"
            }}>
              {(weather && ["storm", "rain", "heavy_rain", "snow"].includes(weather.condition)) || (drone && drone.battery < 15) ? "Unsafe Warning" : "Monitoring Safety"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              ☁️ Weather: 
              <strong style={{
                color: (weather && ["storm", "rain", "heavy_rain", "snow"].includes(weather.condition)) ? "var(--danger)" : "var(--success)"
              }}>
                {(weather && ["storm", "rain", "heavy_rain", "snow"].includes(weather.condition)) ? "Dangerous" : "Safe"}
              </strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              🔋 Battery margin: 
              <strong style={{
                color: (drone && drone.battery < 12.0) ? "var(--danger)" : "var(--success)"
              }}>
                {drone ? `${drone.battery.toFixed(0)}%` : "Awaiting"}
              </strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              📍 Distance check: 
              <strong style={{ color: "var(--accent)" }}>
                Active Flight
              </strong>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              🔑 Confirm Code: 
              <strong style={{ color: "var(--success)" }}>
                {tracking.confirmation_code ? "Required" : "Optional"}
              </strong>
            </div>
          </div>
        </div>
      </>
      )}

            {isDelivered && (
        <div className="tracker__delivered">
          <div style={{ fontSize: 48, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "var(--success)" }}>Delivery completed!</div>
          {tracking.completed_at && (
            <div className="subtle" style={{ fontSize: 12, marginTop: 4 }}>
              {formatBackendDateTime(tracking.completed_at, { locale: "en-US" })}
            </div>
          )}

                    {tracking.dropoff_safety_status === "passed" && (
            <div style={{
              marginTop: 16,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              padding: 12,
              textAlign: "left",
              width: "100%",
              maxWidth: 320
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>🛡️ Drop-off Safety</span>
                <span style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  background: "rgba(51,214,159,0.15)",
                  color: "#33d69f"
                }}>Passed</span>
              </div>
              <div style={{ fontSize: 11, display: "grid", gap: 4 }}>
                <div>☁️ Weather: <strong style={{
                  color: tracking.dropoff_weather_safe === "safe"
                    ? "var(--success)"
                    : tracking.dropoff_weather_safe === "warning"
                      ? "var(--warning)"
                      : "var(--danger)"
                }}>
                  {tracking.dropoff_weather_safe === "safe"
                    ? "Safe"
                    : tracking.dropoff_weather_safe === "warning"
                      ? "Caution (At Risk)"
                      : "Unsafe"
                  }
                </strong></div>
                <div>🔋 Battery at arrival: <strong>{tracking.dropoff_battery_pct ? `${tracking.dropoff_battery_pct.toFixed(0)}%` : "N/A"}</strong></div>
                <div>📍 Distance to destination: <strong>{tracking.dropoff_distance_m != null ? `${tracking.dropoff_distance_m.toFixed(0)} m` : "N/A"}</strong></div>
                <div>🔑 Confirmation code: <strong>{tracking.dropoff_code_required === "Yes" ? "Required" : "Optional"}</strong></div>
              </div>
              {(() => {
                const weather = tracking.dropoff_weather_safe;
                if (weather === "safe") {
                  return (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--success)", fontWeight: 700 }}>
                      ✓ Safe drop-off conditions verified.
                    </div>
                  );
                } else if (weather === "warning") {
                  return (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--warning)", fontWeight: 700 }}>
                      ⚠️ Warning: drop-off completed under at-risk weather conditions.
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}

          {tracking.confirmed_at ? (
            <button
              className="btn btn--primary"
              style={{ marginTop: 16, background: "#16a34a" }}
              onClick={() => setShowPoD(true)}
            >
              View Proof of Delivery (PoD)
            </button>
          ) : (
            <div style={{
              marginTop: 16,
              background: "rgba(255,209,102,0.06)",
              border: "1px solid rgba(255,209,102,0.15)",
              borderRadius: 8,
              padding: 12,
              textAlign: "center",
              width: "100%",
              maxWidth: 320
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ffd166", marginBottom: 4 }}>
                🔑 Recipient Confirmation Required
              </div>
              <div style={{ fontSize: 11, color: "var(--muted2)" }}>
                Please enter the 6-digit confirmation code from your email on the dashboard to view full Proof of Delivery.
              </div>
            </div>
          )}
        </div>
      )}

      {showPoD && <ProofOfDelivery deliveryId={deliveryId} onClose={() => setShowPoD(false)} />}

            <div className="tracker__info">
                {isActive && (
          <div style={{ gridColumn: "1 / -1", marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: pColor.main }}>
              {formatStatusLabel(tracking.status)}
            </div>
            {missionPhase && (
              <div className="subtle" style={{ fontSize: 13, marginTop: 2 }}>
                {missionPhase === "Charging at station" ? "Drone is currently recharging" : `Drone is ${missionPhase.toLowerCase()}`}
              </div>
            )}
          </div>
        )}

                {mission && isActive && (
          <div style={{ gridColumn: "1 / -1", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span className="subtle" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Mission Progress</span>
              <span style={{ fontSize: 14, fontWeight: 800 }}>{mission.progress_pct?.toFixed(0) || 0}%</span>
            </div>
            <div style={{
              height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.05)"
            }}>
              <div style={{
                width: `${mission.progress_pct || 0}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${pColor.main}, ${pColor.main}cc)`,
                borderRadius: 5,
                transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
              }} />
            </div>
          </div>
        )}

                {isActive && (
          <div style={{
            gridColumn: "1 / -1",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginBottom: 24
          }}>
            <div className="tracker__ess-card">
              <div className="label">ETA</div>
              <div className="value" style={{ color: pColor.main }}>
                {etaMinutes != null ? `${etaMinutes < 1 ? "<1" : etaMinutes} min` : "—"}
              </div>
            </div>
            <div className="tracker__ess-card">
              <div className="label">Remaining</div>
              <div className="value">
                {mission?.remaining_km != null ? `${mission.remaining_km.toFixed(1)} km` : "—"}
              </div>
            </div>
            <div className="tracker__ess-card">
              <div className="label">Charging</div>
              <div className="value">
                <span style={{ color: "#ffd166" }}>{chargesDone}</span>
                {estChargesLeft > 0 && <span style={{ fontSize: 12, color: "var(--muted2)" }}> +{estChargesLeft}</span>}
              </div>
            </div>
          </div>
        )}

        <InfoItem label="Total Distance" value={
          mission?.total_distance_km
            ? `${mission.total_distance_km.toFixed(1)} km`
            : tracking.estimated_distance_km
              ? `${tracking.estimated_distance_km.toFixed(1)} km`
              : "—"
        } />
        <InfoItem label="Est. Duration" value={
          tracking.estimated_duration_h
            ? `${(tracking.estimated_duration_h * 60).toFixed(0)} min`
            : "—"
        } />
        {drone && (
          <InfoItem label="Battery" value={`${drone.battery}%`}
            valueColor={drone.battery <= 15 ? "var(--danger)" : drone.battery <= 30 ? "var(--warning)" : "var(--success)"}
          />
        )}
        {drone && (
          <InfoItem label="Drone" value={drone.name || formatDroneName(drone.id)} />
        )}
        {tracking.package_type && tracking.package_type !== "standard" && (
          <InfoItem label="Type" value={tracking.package_type} />
        )}
        {drone?.battery_health != null && drone.battery_health < 100 && (
          <InfoItem label="Battery Health" value={`${drone.battery_health}%`}
            valueColor={drone.battery_health > 80 ? "#33d69f" : drone.battery_health > 60 ? "#ffd166" : "#ff4d6d"}
          />
        )}
      </div>

            {weather && isActive && (
        <div className="tracker__weather" style={{
          background: !weather.can_fly
            ? "rgba(255,77,109,0.1)"
            : weather.battery_multiplier > 1.2
              ? "rgba(255,209,102,0.08)"
              : "rgba(51,214,159,0.06)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: "1.2em" }}>{weather.condition_icon || ""}</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              Weather Conditions at Drone{weather.zone_name ? ` (${weather.zone_name})` : ""}
            </span>
            {weather.source === "openweathermap" && (
              <span style={{
                padding: "1px 6px", borderRadius: 8, fontSize: 10,
                background: "var(--accent2)", color: "white", fontWeight: 600,
              }}>LIVE</span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px", fontSize: 13 }}>
            <div>
              <span className="subtle" style={{ fontSize: 11 }}>Condition</span>
              <div style={{ fontWeight: 600 }}>
                {weather.condition_label || weather.condition}
                {weather.api_description && (
                  <span style={{ fontWeight: 400, fontSize: "0.85em", color: "#888" }}> — {weather.api_description}</span>
                )}
              </div>
            </div>
            <div>
              <span className="subtle" style={{ fontSize: 11 }}>Temperature</span>
              <div style={{ fontWeight: 600 }}>{weather.temperature != null ? `${weather.temperature}°C` : "—"}</div>
            </div>
            <div>
              <span className="subtle" style={{ fontSize: 11 }}>Wind</span>
              <div style={{ fontWeight: 600 }}>
                {weather.wind_speed != null ? `${weather.wind_speed} km/h` : "—"}
                {weather.wind_direction && ` ${weather.wind_direction}`}
              </div>
            </div>
            <div>
              <span className="subtle" style={{ fontSize: 11 }}>Speed Impact</span>
              <div style={{ fontWeight: 600, color: weather.speed_multiplier < 0.8 ? "var(--warning)" : "inherit" }}>
                ×{weather.speed_multiplier}
              </div>
            </div>
            <div>
              <span className="subtle" style={{ fontSize: 11 }}>Battery Impact</span>
              <div style={{ fontWeight: 600, color: weather.battery_multiplier > 1.3 ? "var(--danger)" : weather.battery_multiplier > 1.1 ? "var(--warning)" : "inherit" }}>
                ×{weather.battery_multiplier}
              </div>
            </div>
            <div>
              <span className="subtle" style={{ fontSize: 11 }}>Visibility</span>
              <div style={{ fontWeight: 600 }}>{weather.visibility_km != null ? `${weather.visibility_km} km` : "—"}</div>
            </div>
          </div>
          {!weather.can_fly && (
            <div style={{ marginTop: 6, color: "var(--danger)", fontWeight: 700, fontSize: 13 }}>
              Flight restricted! The drone is waiting for favorable conditions.
            </div>
          )}
          {weather.warning && weather.can_fly && (
            <div style={{ marginTop: 4, color: "var(--warning)", fontSize: 12 }}>
              {weather.warning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value, valueColor }) {
  return (
    <div style={{ padding: "8px 0" }}>
      <div className="subtle" style={{ fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: valueColor || "inherit" }}>{value}</div>
    </div>
  );
}

function SummaryItem({ label, value, meta, accent = false }) {
  return (
    <div className={`tracker__summary-item${accent ? " tracker__summary-item--accent" : ""}`}>
      <div className="tracker__summary-label">{label}</div>
      <div className="tracker__summary-value">{value}</div>
      {meta && <div className="tracker__summary-meta">{meta}</div>}
    </div>
  );
}

function formatDroneName(id) {
  if (!id) return "Unknown";
  const greek = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon"];
  return `AF-${String(id).padStart(2, '0')} ${greek[(id - 1) % greek.length]}`;
}
