import React, { useEffect, useState } from "react";
import { missionsAPI } from "../services/api";
import { formatBackendTime } from "../utils/datetime";
import { 
  History, Info, Activity, Clock, 
  MapPin, Zap, ChevronDown, ChevronUp 
} from "lucide-react";

const EVENT_CONFIG = {
  START: { icon: "▶", color: "#7c5cff", label: "Mission started" },
  PICKING_UP: { icon: "↗", color: "#a78bfa", label: "En route to pickup" },
  PICKED_UP: { icon: "✓", color: "#7c5cff", label: "Package picked up" },
  IN_TRANSIT: { icon: "✈", color: "#6ae4ff", label: "In transit to destination" },
  ARRIVED: { icon: "✓", color: "#33d69f", label: "Destination reached" },
  FAILED: { icon: "✗", color: "#ff4d6d", label: "Mission failed" },
  DELIVERY_CANCELLED: { icon: "⊘", color: "#adb5bd", label: "Delivery cancelled" },
  CHARGE: { icon: "⚡", color: "#ffd166", label: "Charging at station" },
  RESUME: { icon: "▶", color: "#6ae4ff", label: "Flight resumed" },
  NFZ_REROUTE: { icon: "⊘", color: "#fd7e14", label: "NFZ reroute" },
  WEATHER_HOLD: { icon: "☂", color: "#8e99a4", label: "Weather hold" },
};

export default function MissionDetail({ mission, onBack, integrated = false }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (!mission) return;
    let cancelled = false;

    const fetchEvents = async () => {
      try {
        setLoading(true);
        const res = await missionsAPI.getEvents(mission.id);
        if (!cancelled) setEvents(res.data || []);
      } catch {
              } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchEvents();
    const interval = setInterval(fetchEvents, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mission]);

  if (!mission) return null;

  const isActive = ["planned", "pending", "en_route_pickup", "at_pickup", "en_route_delivery", "in_progress", "charging"].includes(mission.status);
  const statusColor = mission.status === 'completed' ? "#33d69f" : mission.status === 'failed' ? "#ff4d6d" : isActive ? "#7c5cff" : "#8e99a4";

  const renderContent = () => (
    <div className="stack" style={{ gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <MiniStat icon={Zap} label="Battery" value={`${mission.drone_battery || 0}%`} />
        <MiniStat icon={Activity} label="Status" value={mission.status.replace(/_/g, ' ')} color={statusColor} />
        <MiniStat icon={Clock} label="Started" value={formatBackendTime(mission.start_time)} />
        <MiniStat icon={MapPin} label="Remaining" value={mission.remaining_km != null ? `${mission.remaining_km.toFixed(1)} km` : "—"} />
      </div>

            {mission.progress_pct != null && (
        <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11 }}>
            <span style={{ fontWeight: 700, textTransform: "uppercase", color: "var(--muted2)" }}>Mission Progress</span>
            <span style={{ fontWeight: 800, color: statusColor }}>{mission.progress_pct.toFixed(0)}%</span>
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${mission.progress_pct}%`, height: "100%", background: statusColor, transition: "width 0.5s" }} />
          </div>
        </div>
      )}

            <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <History size={16} color="var(--muted)" />
          <span style={{ fontWeight: 800, fontSize: 13 }}>Live Event Log</span>
        </div>

        <div style={{ position: "relative", paddingLeft: 20 }}>
          <div style={{ position: "absolute", left: 7, top: 10, bottom: 10, width: 2, borderLeft: "2px dashed rgba(255,255,255,0.1)" }} />
          
          {loading && events.length === 0 ? (
             <div className="subtle" style={{ fontSize: 12 }}>Streaming events...</div>
          ) : events.length === 0 ? (
            <div className="subtle" style={{ fontSize: 12 }}>No events recorded yet</div>
          ) : (
            events.slice(0, 5).map((event, i) => {
              const cfg = EVENT_CONFIG[event.event_type] || { icon: "•", color: "#6c757d", label: event.event_type };
              return (
                <div key={event.id} style={{ position: "relative", marginBottom: 12 }}>
                  <div style={{ 
                    position: "absolute", left: -20, top: 2, width: 18, height: 18, borderRadius: "50%", 
                    background: "rgba(11, 18, 32, 1)", border: `2px solid ${cfg.color}`,
                    boxShadow: `0 0 10px ${cfg.color}66`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10
                  }}>
                    {cfg.icon}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                      <span className="subtle" style={{ fontSize: 10 }}>{formatBackendTime(event.timestamp, { options: { hour: '2-digit', minute: '2-digit' } })}</span>
                    </div>
                    {event.details && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{event.details}</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  if (integrated) {
    return (
      <div style={{ 
        background: "rgba(11, 18, 32, 0.7)", 
        backdropFilter: "blur(20px)",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.1)",
        borderTop: "1px solid rgba(255,255,255,0.2)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
        overflow: "hidden"
      }}>
        <div 
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ 
            padding: "12px 20px", 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            cursor: "pointer",
            background: "rgba(255,255,255,0.02)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Info size={16} color="var(--dispatcher-accent)" />
            <span style={{ fontWeight: 800, fontSize: 14 }}>Mission Intelligence</span>
          </div>
          {isExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </div>
        {isExpanded && <div style={{ padding: 20 }}>{renderContent()}</div>}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn" onClick={onBack}>← Back</button>
          <div>
            <h1>Mission #{mission.id}</h1>
            <p className="subtle">Telemetry Analysis</p>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-body">{renderContent()}</div>
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color }) {
  return (
    <div style={{ 
      padding: "10px 12px", 
      background: "rgba(255,255,255,0.02)", 
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.05)",
      display: "flex",
      alignItems: "center",
      gap: 10
    }}>
      <div style={{ 
        width: 28, height: 28, borderRadius: 8, 
        background: color ? `${color}15` : "rgba(255,255,255,0.05)",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
        <Icon size={14} color={color || "var(--muted)"} />
      </div>
      <div>
        <div style={{ fontSize: 9, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: color || "white" }}>{value}</div>
      </div>
    </div>
  );
}
