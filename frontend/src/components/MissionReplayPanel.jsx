import React, { useEffect, useState, useRef, useCallback } from "react";
import { Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { missionsAPI } from "../services/api";
import droneIconBlue from "../assets/icons/drone-icon.png";
import { formatBackendTime } from "../utils/datetime";

const EVENT_CFG = {
  START:             { icon: "▶", color: "#7c5cff", label: "Mission started" },
  PICKING_UP:        { icon: "↗", color: "#a78bfa", label: "En route to pickup" },
  PICKED_UP:         { icon: "📦", color: "#7c5cff", label: "Package picked up" },
  IN_TRANSIT:        { icon: "✈", color: "#6ae4ff", label: "In transit" },
  ARRIVED:           { icon: "✓", color: "#33d69f", label: "Delivered" },
  FAILED:            { icon: "✗", color: "#ff4d6d", label: "Mission failed" },
  DELIVERY_CANCELLED:{ icon: "⊘", color: "#adb5bd", label: "Cancelled" },
  CHARGE:            { icon: "⚡", color: "#ffd166", label: "Charging" },
  RESUME:            { icon: "▶", color: "#6ae4ff", label: "Resumed" },
  NFZ_REROUTE:       { icon: "⊘", color: "#fd7e14", label: "NFZ reroute" },
  WEATHER_HOLD:      { icon: "☂", color: "#8e99a4", label: "Weather hold" },
  MANUAL_PAUSE:      { icon: "⏸", color: "#fbbf24", label: "Manually paused" },
  MANUAL_RESUME:     { icon: "▶", color: "#fbbf24", label: "Manually resumed" },
};

const STATUS_COLOR = {
  completed: "#33d69f",
  failed: "#ff4d6d",
  aborted: "#adb5bd",
  in_progress: "#7c5cff",
  en_route_pickup: "#a78bfa",
  en_route_delivery: "#6ae4ff",
};

const replayDroneIcon = L.divIcon({
  className: "custom-drone-icon",
  html: `<div class="drone-marker-wrapper">
    <img src="${droneIconBlue}" style="width: 36px; height: 36px;" />
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20],
});

const makePickupIcon = () => L.divIcon({
  className: "",
  html: `<div style="
    width:24px;height:24px;border-radius:50%;
    background:linear-gradient(135deg,#7c5cff88,#a78bfa88);
    border:2px solid #a78bfa;
    box-shadow:0 0 10px rgba(167,139,250,0.5);
    display:flex;align-items:center;justify-content:center;
    font-size:12px;line-height:1">📦</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -14],
});

const makeDestIcon = () => L.divIcon({
  className: "",
  html: `<div style="
    width:24px;height:24px;border-radius:50%;
    background:linear-gradient(135deg,#33d69f88,#6ae4ff88);
    border:2px solid #33d69f;
    box-shadow:0 0 10px rgba(51,214,159,0.5);
    display:flex;align-items:center;justify-content:center;
    font-size:12px;line-height:1">🏁</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -14],
});

const makeEventIcon = (color) => L.divIcon({
  className: "",
  html: `<div style="
    width:20px;height:20px;border-radius:50%;
    background:${color}33;border:2px solid ${color};
    box-shadow:0 0 8px ${color}66;
    display:flex;align-items:center;justify-content:center;
    font-size:10px;line-height:1">●</div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
});

function interpolateRoute(route, frac) {
  if (!route || route.length === 0) return null;
  if (frac <= 0) return route[0];
  if (frac >= 1) return route[route.length - 1];
  const idx = Math.floor(frac * (route.length - 1));
  const t = frac * (route.length - 1) - idx;
  const a = route[Math.min(idx, route.length - 1)];
  const b = route[Math.min(idx + 1, route.length - 1)];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function FitReplayBounds({ replayData }) {
  const map = useMap();
  useEffect(() => {
    if (!replayData?.route_path?.length) return;
    const bounds = L.latLngBounds(replayData.route_path.map(p => [p[0], p[1]]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
  }, [replayData, map]);
  return null;
}

export function MissionReplayOverlay({ replayData, showEvents }) {
  const [playFrac, setPlayFrac] = useState(0);

  useEffect(() => {
    const handleTick = (e) => setPlayFrac(e.detail);
    window.addEventListener('replay-tick', handleTick);
    
        setPlayFrac(0);
    
    return () => window.removeEventListener('replay-tick', handleTick);
  }, [replayData]);

  if (!replayData) return null;

  const getDistFrac = (tFrac) => {
    if (!replayData.keyframes || replayData.keyframes.length === 0) return tFrac;
    const kfs = replayData.keyframes;
    for (let i = 0; i < kfs.length - 1; i++) {
       if (tFrac >= kfs[i].time_frac && tFrac <= kfs[i+1].time_frac) {
          const tDist = kfs[i+1].time_frac - kfs[i].time_frac;
          if (tDist <= 0.0001) return kfs[i].dist_frac;
          const ratio = (tFrac - kfs[i].time_frac) / tDist;
          return kfs[i].dist_frac + ratio * (kfs[i+1].dist_frac - kfs[i].dist_frac);
       }
    }
    return kfs[kfs.length - 1].dist_frac;
  };

  const { route_path, pickup, destination, events } = replayData;
  const distFrac = getDistFrac(playFrac);
  const dronePos = interpolateRoute(route_path, distFrac);

    const splitIdx = Math.floor(distFrac * (route_path.length - 1));
  const travelled = route_path.slice(0, splitIdx + 1);
  const remaining = route_path.slice(splitIdx);

  const pickupIcon = makePickupIcon();
  const destIcon = makeDestIcon();

  return (
    <>
      <FitReplayBounds replayData={replayData} />

            {remaining.length >= 2 && (
        <Polyline
          positions={remaining}
          pathOptions={{ color: "rgba(124,92,255,0.45)", weight: 8, dashArray: "8 12", lineCap: "round" }}
        />
      )}

            {travelled.length >= 2 && (
        <>
          <Polyline
            positions={travelled}
            pathOptions={{ color: "rgba(106,228,255,0.45)", weight: 22, lineCap: "round" }}
          />
          <Polyline
            positions={travelled}
            pathOptions={{ color: "#6ae4ff", weight: 8, lineCap: "round" }}
          />
          <Polyline
            positions={travelled}
            pathOptions={{ color: "rgba(255,255,255,0.85)", weight: 2.5, dashArray: "4 18", lineCap: "round" }}
          />
        </>
      )}

            {pickup?.lat != null && pickup?.lon != null && (
        <Marker position={[pickup.lat, pickup.lon]} icon={pickupIcon}>
          <Popup>
            <b>📦 Pickup</b><br />
            {pickup.lat.toFixed(4)}°N, {pickup.lon.toFixed(4)}°E
          </Popup>
        </Marker>
      )}

            {destination?.lat != null && destination?.lon != null && (
        <Marker position={[destination.lat, destination.lon]} icon={destIcon}>
          <Popup>
            <b>🏁 Destination</b><br />
            {destination.lat.toFixed(4)}°N, {destination.lon.toFixed(4)}°E
          </Popup>
        </Marker>
      )}

            {showEvents && events.map((ev, i) => {
        if (ev.lat == null || ev.lon == null) return null;
                if (ev.progress_frac > playFrac + 0.01) return null;
        const cfg = EVENT_CFG[ev.event_type] || { icon: "●", color: "#6c757d", label: ev.event_type };
        return (
          <Marker key={ev.id || i} position={[ev.lat, ev.lon]} icon={makeEventIcon(cfg.color)}>
            <Popup>
              <div style={{ minWidth: 160 }}>
                <b style={{ color: cfg.color }}>{cfg.icon} {cfg.label}</b><br />
                <span style={{ fontSize: "0.8em", opacity: 0.7 }}>
                  {formatBackendTime(ev.timestamp, { locale: "en-US" })}
                </span>
                {ev.details && (
                  <div style={{ marginTop: 4, fontSize: "0.85em" }}>{ev.details}</div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}

            {dronePos && (
        <Marker position={dronePos} icon={replayDroneIcon} zIndexOffset={2000}>
          <Popup>
            <b>🚁 {replayData.drone_name || `Drone #${replayData.drone_id}`}</b><br />
            Progress: {(playFrac * 100).toFixed(1)}%<br />
            <span style={{ fontSize: "0.8em", opacity: 0.7 }}>
              {replayData.drone_name} · Mission #{replayData.mission_id}
            </span>
          </Popup>
        </Marker>
      )}
    </>
  );
}

export default function MissionReplayPanel({ onReplayChange, missionId = null, integrated = false }) {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(missionId);
  const [replayData, setReplayData] = useState(null);

    useEffect(() => {
    setSelectedId(missionId);
    setReplayData(null);
    setPlayFrac(0);
    setIsPlaying(false);
  }, [missionId]);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playFrac, setPlayFrac] = useState(0);
  const [playSpeed, setPlaySpeed] = useState(1);
  const [showEvents, setShowEvents] = useState(false);

  const animRef = useRef(null);
  const lastTimeRef = useRef(null);

    useEffect(() => {
    if (missionId) return;
    setLoading(true);
    missionsAPI.list({ status: "completed,failed,aborted", sort_by: "start_time", sort_order: "desc", page_size: 30 })
      .then(r => setMissions(r.data?.items || r.data || []))
      .catch(() => setMissions([]))
      .finally(() => setLoading(false));
  }, [missionId]);

    useEffect(() => {
    if (!selectedId) {
      setReplayData(null);
      setPlayFrac(0);
      setIsPlaying(false);
      onReplayChange(null, false);
      return;
    }
    setLoadingReplay(true);
    setReplayData(null);
    setPlayFrac(0);
    setIsPlaying(false);
    missionsAPI.getReplay(selectedId)
      .then(r => {
        setReplayData(r.data);
        onReplayChange(r.data, showEvents);
      })
      .catch(() => setReplayData(null))
      .finally(() => setLoadingReplay(false));
  }, [selectedId]);

    useEffect(() => {
    if (replayData) {
      onReplayChange(replayData, showEvents);
    }
  }, [replayData, showEvents, onReplayChange]);

    const animate = useCallback((timestamp) => {
    if (lastTimeRef.current === null) {
      lastTimeRef.current = timestamp;
    }
    const elapsed = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;

        const stepPerSec = playSpeed * 0.01;
    const step = stepPerSec * (elapsed / 1000);

    setPlayFrac(prev => {
      const next = prev + step;
      let finalFrac = next;
      if (next >= 1) {
        setIsPlaying(false);
        finalFrac = 1;
      }
      window.dispatchEvent(new CustomEvent('replay-tick', { detail: finalFrac }));
      return finalFrac;
    });

    animRef.current = requestAnimationFrame(animate);
  }, [playSpeed]);

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = null;
      animRef.current = requestAnimationFrame(animate);
    } else {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isPlaying, animate]);

  const handleScrub = (e) => {
    const val = parseFloat(e.target.value);
    setPlayFrac(val);
    window.dispatchEvent(new CustomEvent('replay-tick', { detail: val }));
    if (isPlaying) setIsPlaying(false);
  };

  const handlePlayPause = () => {
    if (playFrac >= 1) {
      setPlayFrac(0);
      window.dispatchEvent(new CustomEvent('replay-tick', { detail: 0 }));
      setIsPlaying(true);
    } else {
      setIsPlaying(p => !p);
    }
  };

  const statusColor = (s) => STATUS_COLOR[s] || "#8e99a4";
  const statusLabel = (s) => ({
    completed: "Completed", failed: "Failed", aborted: "Aborted",
    in_progress: "In Progress", en_route_pickup: "En Route",
  }[s] || s);

  return (
    <div className="replay-inner-container">
      {loadingReplay && (
        <div style={{ fontSize: "0.8rem", opacity: 0.5, textAlign: "center", padding: 16 }}>
          Calculating route...
        </div>
      )}

      {replayData && !loadingReplay && (
        <div className="replay-controls">
          <div className="replay-info-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700 }}>Mission #{replayData.mission_id}</span>
              <span style={{
                fontSize: "0.7rem", fontWeight: 700,
                color: statusColor(replayData.mission_status),
              }}>
                {statusLabel(replayData.mission_status)}
              </span>
            </div>
          </div>
          <div style={{ fontSize: "0.72rem", opacity: 0.55, marginBottom: 8 }}>
            Drone {replayData.drone_name || `#${replayData.drone_id}`}
            {" · "}{replayData.total_route_km} km
            {replayData.duration_sec && ` · ${Math.round(replayData.duration_sec / 60)} min`}
          </div>

                    <div className="replay-scrubber-row" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
            <span style={{ fontSize: "0.75rem", opacity: 0.8, minWidth: 36, fontWeight: 800, color: 'var(--dispatcher-accent)' }}>
              {(playFrac * 100).toFixed(0)}%
            </span>
            <div style={{ flex: 1, position: 'relative', height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>
               <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${playFrac * 100}%`, background: 'var(--dispatcher-accent)', borderRadius: 4, boxShadow: '0 0 10px rgba(106, 228, 255, 0.4)' }} />
               <input
                 type="range"
                 min={0}
                 max={1}
                 step={0.001}
                 value={playFrac}
                 onChange={handleScrub}
                 style={{
                    position: 'absolute', top: -6, left: 0, width: '100%', height: 18, margin: 0, 
                    opacity: 0, cursor: 'pointer', zIndex: 10
                 }}
               />
               <div style={{ position: 'absolute', top: -4, left: `calc(${playFrac * 100}% - 7px)`, width: 14, height: 14, background: 'white', borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
            </div>
            <span style={{ fontSize: "0.75rem", opacity: 0.6, minWidth: 36, fontWeight: 800, textAlign: 'right' }}>100%</span>
          </div>

                    <div className="replay-btn-row" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="map-btn-chip" onClick={() => { setPlayFrac(0); window.dispatchEvent(new CustomEvent('replay-tick', { detail: 0 })); setIsPlaying(false); }} style={{ flex: 1, padding: "8px 0", background: "rgba(255,255,255,0.05)", borderRadius: 8, transition: "all 0.2s" }}>
              ⏮ Reset
            </button>
            <button
              className={`map-btn-chip ${isPlaying ? "map-btn-chip--active" : ""}`}
              onClick={handlePlayPause}
              style={{ flex: 2, padding: "8px 0", background: isPlaying ? "rgba(106, 228, 255, 0.15)" : "rgba(106, 228, 255, 0.1)", border: `1px solid rgba(106, 228, 255, ${isPlaying ? '0.4' : '0.2'})`, color: isPlaying ? "white" : "var(--dispatcher-accent)", borderRadius: 8, fontWeight: 800, transition: "all 0.2s", boxShadow: isPlaying ? "0 0 15px rgba(106, 228, 255, 0.2)" : "none" }}
            >
              {isPlaying ? "⏸ Pause" : playFrac >= 1 ? "⏮ Replay" : "▶ Play"}
            </button>
            <button className="map-btn-chip" onClick={() => { setPlayFrac(1); window.dispatchEvent(new CustomEvent('replay-tick', { detail: 1 })); setIsPlaying(false); }} style={{ flex: 1, padding: "8px 0", background: "rgba(255,255,255,0.05)", borderRadius: 8, transition: "all 0.2s" }}>
              ⏭ Skip
            </button>
          </div>

                    <div className="replay-speed-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: "0.75rem", opacity: 0.6, fontWeight: 700, marginRight: 4 }}>Speed:</span>
            {[0.5, 1, 2, 5].map(s => (
              <button
                key={s}
                className={`map-btn-chip ${playSpeed === s ? "map-btn-chip--active" : ""}`}
                style={{ 
                  flex: 1, 
                  fontSize: "0.7rem", 
                  padding: "4px 0", 
                  borderRadius: 6,
                  background: playSpeed === s ? "var(--dispatcher-accent)" : "rgba(255,255,255,0.05)",
                  color: playSpeed === s ? "var(--bg0)" : "var(--muted)",
                  fontWeight: 800,
                  transition: "all 0.2s"
                }}
                onClick={() => setPlaySpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>

                    <div style={{ marginTop: 12 }}>
            <button
              className={`map-btn-chip ${showEvents ? "map-btn-chip--active" : ""}`}
              style={{ fontSize: "0.7rem", width: '100%', justifyContent: 'center' }}
              onClick={() => setShowEvents(!showEvents)}
            >
              {showEvents ? "▴ Hide Events" : "▾ Show Mission Timeline"}
            </button>
          </div>

          {showEvents && replayData.events && replayData.events.length > 0 && (
            <div className="replay-events-list-compact" style={{ 
              marginTop: 10, 
              maxHeight: 180, 
              overflowY: 'auto',
              padding: '8px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.05)'
            }}>
              {replayData.events.map((ev, i) => {
                const cfg = EVENT_CFG[ev.event_type] || { icon: "●", color: "#6c757d", label: ev.event_type };
                const isPast = ev.progress_frac <= playFrac + 0.01;
                return (
                  <div key={ev.id || i} style={{ 
                    display: 'flex', 
                    gap: 10, 
                    padding: '6px 0',
                    opacity: isPast ? 1 : 0.4,
                    fontSize: '0.75rem',
                    borderBottom: i < replayData.events.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none'
                  }}>
                    <span style={{ color: cfg.color, width: 14, textAlign: 'center' }}>{cfg.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{cfg.label}</div>
                      {ev.details && <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{ev.details}</div>}
                    </div>
                    <span style={{ fontSize: '0.65rem', opacity: 0.4 }}>
                      {formatBackendTime(ev.timestamp, { options: { hour: '2-digit', minute: '2-digit' } })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

