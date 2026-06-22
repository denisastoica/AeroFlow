import React, { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import MissionDetail from "./MissionDetail";
import DroneMap from "./DroneMap";
import MissionReplayPanel from "./MissionReplayPanel";
import { useWebSocketMonitor } from "../hooks/useWebSocketMonitor";
import { 
  Rocket, History, List as ListIcon, 
  Map as MapIcon, Info, Activity, 
  ArrowLeft, ChevronRight, Navigation
} from "lucide-react";

const MISSION_STATUS = {
  planned:          { color: "#ffd166", label: "Planned",           bg: "rgba(255,209,102,0.1)" },
  pending:          { color: "#ffd166", label: "Pending",           bg: "rgba(255,209,102,0.1)" },
  en_route_pickup:  { color: "#6ae4ff", label: "In Progress",       bg: "rgba(106,228,255,0.1)" },
  at_pickup:        { color: "#6ae4ff", label: "In Progress",       bg: "rgba(106,228,255,0.1)" },
  en_route_delivery:{ color: "#6ae4ff", label: "In Progress",       bg: "rgba(106,228,255,0.1)" },
  in_progress:      { color: "#6ae4ff", label: "In Progress",       bg: "rgba(106,228,255,0.1)" },
  going_to_charge:  { color: "#ff9f43", label: "Going to Charge",   bg: "rgba(255,159,67,0.1)" },
  charging:         { color: "#ff9f43", label: "Charging",          bg: "rgba(255,159,67,0.1)" },
  paused:           { color: "#fbbf24", label: "Weather Hold",      bg: "rgba(251,191,36,0.1)" },
  completed:        { color: "#33d69f", label: "Completed",         bg: "rgba(51,214,159,0.1)" },
  failed:           { color: "#ff4d6d", label: "Failed",            bg: "rgba(255,77,109,0.1)" },
  aborted:          { color: "#adb5bd", label: "Cancelled",         bg: "rgba(173,181,189,0.1)" },
  cancelled:        { color: "#adb5bd", label: "Cancelled",         bg: "rgba(173,181,189,0.1)" },
};

const ACTIVE_STATUSES = new Set([
  "planned", "pending", "en_route_pickup", "at_pickup",
  "en_route_delivery", "in_progress", "charging", "paused",
]);
const FINISHED_STATUSES = new Set(["completed", "failed", "aborted", "cancelled"]);

function formatDuration(hours) {
  if (hours == null) return "—";
  const mins = hours * 60;
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${Math.round(mins)} min`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}

export default function MissionList({ refreshTrigger }) {
  const toast = useToast();
  const [missions, setMissions] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedMission, setSelectedMission] = useState(null);
  const [tab, setTab] = useState("active"); 
  const [statusFilter, setStatusFilter] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayData, setReplayData] = useState(null);
  const [replayShowEvents, setReplayShowEvents] = useState(true);

  const handleReplayChange = (data, showEv) => {
    setReplayData(data);
    setReplayShowEvents(showEv);
  };

  const [liveDrones, setLiveDrones] = useState({});

  const handleDroneUpdate = React.useCallback((update) => {
    if (!update.mission_id) return;
    setLiveDrones((prev) => {
      const existing = prev[update.mission_id] || {};
      return {
        ...prev,
        [update.mission_id]: {
          battery: update.battery !== undefined ? update.battery : existing.battery,
          speed: update.speed !== undefined ? update.speed : existing.speed,
          progress_pct: update.mission_progress_pct !== undefined ? update.mission_progress_pct : existing.progress_pct,
          remaining_km: update.mission_remaining_km !== undefined ? update.mission_remaining_km : existing.remaining_km,
          remaining_duration_h: update.mission_remaining_duration_h !== undefined ? update.mission_remaining_duration_h : existing.remaining_duration_h,
          status: update.mission_status !== undefined ? update.mission_status : existing.status,
        }
      };
    });
  }, []);

  useWebSocketMonitor(
    handleDroneUpdate,
    null,
    null,
    null
  );

  const fetchMissions = async () => {
    if (!missions.length) setLoading(true);
    try {
      const response = await api.get("/missions/", { params: { page_size: 100 } });
      setMissions(response.data?.items || []);
    } catch (err) {
      const msg = getErrorMessage(err, "Error fetching missions");
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get("/missions/stats");
      setStats(response.data);
    } catch (err) {}
  };

  useEffect(() => {
    fetchMissions();
    fetchStats();
    const interval = setInterval(() => {
      fetchMissions();
      fetchStats();
    }, 15000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  const activeMissions = useMemo(() => missions.filter((m) => ACTIVE_STATUSES.has(m.status)), [missions]);
  const historyMissions = useMemo(
    () => missions.filter((m) => FINISHED_STATUSES.has(m.status)).sort((a, b) => {
      const tb = b.end_time ? new Date(b.end_time) : new Date(0);
      const ta = a.end_time ? new Date(a.end_time) : new Date(0);
      return tb - ta;
    }),
    [missions],
  );

  const listToRender = useMemo(() => {
    let base = tab === "active" ? activeMissions : tab === "history" ? historyMissions : missions;
    if (statusFilter) base = base.filter((m) => m.status === statusFilter);
    return base.map((m) => {
      const live = liveDrones[m.id];
      if (live) {
        return {
          ...m,
          drone_battery: live.battery ?? m.drone_battery,
          drone_speed: live.speed ?? m.drone_speed,
          remaining_duration_h: live.remaining_duration_h ?? m.remaining_duration_h,
          progress_pct: live.progress_pct ?? m.progress_pct,
          remaining_km: live.remaining_km ?? m.remaining_km,
          status: live.status ?? m.status,
        };
      }
      return m;
    });
  }, [tab, activeMissions, historyMissions, missions, statusFilter, liveDrones]);

    const selectedMissionData = useMemo(() => {
    if (!selectedMission) return null;
    const baseMission = missions.find(m => m.id === selectedMission.id) || selectedMission;
    
        const live = liveDrones[baseMission.id];
    if (live) {
      return {
        ...baseMission,
        drone_battery: live.battery ?? baseMission.drone_battery,
        drone_speed: live.speed ?? baseMission.drone_speed,
        remaining_duration_h: live.remaining_duration_h ?? baseMission.remaining_duration_h,
        progress_pct: live.progress_pct ?? baseMission.progress_pct,
        remaining_km: live.remaining_km ?? baseMission.remaining_km,
        status: live.status ?? baseMission.status,
      };
    }
    return baseMission;
  }, [selectedMission, missions, liveDrones]);

  return (
    <div className="mission-dashboard theme-dispatcher" style={{ 
      display: "flex", 
      height: "calc(100vh - 64px)", 
      background: "var(--bg0)",
      overflow: "hidden"
    }}>
            <aside style={{ 
        width: isSidebarOpen ? "380px" : "0",
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        background: "rgba(17, 26, 46, 0.4)",
        backdropFilter: "blur(12px)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}>
                <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          style={{
            position: "absolute",
            right: -24,
            top: "50%",
            transform: "translateY(-50%)",
            width: 24,
            height: 48,
            background: "var(--bg1)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderLeft: "none",
            borderRadius: "0 8px 8px 0",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
          }}
        >
          <ChevronRight size={16} style={{ transform: isSidebarOpen ? "rotate(180deg)" : "rotate(0)" }} />
        </button>

        {isSidebarOpen && (
          <div style={{ padding: 20, display: "flex", flexDirection: "column", height: "100%", width: 380 }}>
            <header style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <Rocket size={20} color="var(--dispatcher-accent)" />
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Mission Control</h2>
              </div>
              <p className="subtle" style={{ fontSize: 13, margin: 0 }}>Fleet deployment monitoring</p>
            </header>

                        {stats && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700 }}>Active</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--dispatcher-accent)" }}>{stats.in_flight || 0}</div>
                </div>
                <div style={{ padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--muted2)", fontWeight: 700 }}>Total Completed</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--success)" }}>
                    {stats.completed || 0}
                  </div>
                </div>
              </div>
            )}

                        <div style={{ 
              display: "flex", 
              background: "rgba(0,0,0,0.2)", 
              borderRadius: 10, 
              padding: 4, 
              marginBottom: 16,
              gap: 4
            }}>
              {[
                { key: "active", icon: Activity, label: "Live" },
                { key: "history", icon: History, label: "Log" },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "8px 0",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    background: tab === t.key ? "rgba(255,255,255,0.08)" : "transparent",
                    color: tab === t.key ? "white" : "var(--muted)",
                    transition: "all 0.2s"
                  }}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
            </div>

                        <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }} className="custom-scroll">
              {loading && missions.length === 0 ? (
                [1,2,3,4].map(i => <div key={i} className="skeleton-card" style={{ height: 80, marginBottom: 12, borderRadius: 14 }} />)
              ) : listToRender.length > 0 ? (
                listToRender.map(m => {
                  const cfg = MISSION_STATUS[m.status] || { color: "#adb5bd", label: m.status, bg: "rgba(255,255,255,0.05)" };
                  const isSelected = selectedMission?.id === m.id;
                  return (
                    <div 
                      key={m.id}
                      className="mission-card-hover"
                      onClick={() => setSelectedMission(m)}
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        background: isSelected ? "rgba(106, 228, 255, 0.1)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isSelected ? "rgba(106, 228, 255, 0.4)" : "rgba(255,255,255,0.05)"}`,
                        boxShadow: isSelected ? "0 4px 12px rgba(106, 228, 255, 0.15)" : "none",
                        marginBottom: 10,
                        cursor: "pointer",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                        position: "relative",
                        overflow: "hidden",
                        transform: isSelected ? "scale(1.02)" : "scale(1)"
                      }}
                    >
                      {isSelected && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: "var(--dispatcher-accent)", boxShadow: "0 0 8px var(--dispatcher-accent)" }} />}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
                          Mission #{m.id}
                          {ACTIVE_STATUSES.has(m.status) && (
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dispatcher-accent)", boxShadow: "0 0 6px var(--dispatcher-accent)", animation: "pulse-fast 1.5s infinite" }}></span>
                          )}
                        </span>
                        <span style={{ 
                          fontSize: 10, 
                          fontWeight: 900, 
                          textTransform: "uppercase", 
                          color: cfg.color,
                          background: cfg.bg,
                          padding: "4px 8px",
                          borderRadius: 6,
                          letterSpacing: "0.05em",
                          border: `1px solid ${cfg.color}33`
                        }}>{cfg.label}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{formatDroneName(m.drone_id)} • Del #{m.delivery_id}</div>
                        {m.progress_pct != null && (
                          <div style={{ fontSize: 12, fontWeight: 700, color: "white" }}>{m.progress_pct.toFixed(0)}%</div>
                        )}
                      </div>
                      {m.progress_pct != null && (
                        <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
                          <div style={{ width: `${m.progress_pct}%`, height: "100%", background: cfg.color, transition: "width 0.5s" }} />
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={{ textAlign: "center", padding: 40, color: "var(--muted2)" }}>
                  {tab === "active" ? (
                    <>
                      <Rocket size={40} strokeWidth={1} style={{ marginBottom: 12, opacity: 0.5 }} />
                      <h3 style={{ color: "white", margin: "0 0 8px 0", fontSize: 16 }}>No active missions</h3>
                      <p style={{ fontSize: 13, margin: 0, lineHeight: 1.4 }}>Start a delivery or run a scenario<br/>to monitor live telemetry.</p>
                    </>
                  ) : (
                    <>
                      <History size={40} strokeWidth={1} style={{ marginBottom: 12, opacity: 0.5 }} />
                      <p>No missions found in log.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

            <main style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }}>
        {selectedMissionData ? (
          <>
                        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
              <DroneMap 
                singleDrone={isReplaying ? null : {
                  id: selectedMissionData.drone_id,
                  mission_id: selectedMissionData.id,
                  delivery_id: selectedMissionData.delivery_id,
                  latitude: selectedMissionData.drone_lat,
                  longitude: selectedMissionData.drone_lon,
                  status: selectedMissionData.status,
                  route_path: selectedMissionData.route_path,
                  planned_route_path: selectedMissionData.planned_route_path,
                  route_index: selectedMissionData.route_index,
                  pickup_lat: selectedMissionData.pickup_lat,
                  pickup_lon: selectedMissionData.pickup_lon,
                  dest_lat: selectedMissionData.dest_lat,
                  dest_lon: selectedMissionData.dest_lon,
                  battery: selectedMissionData.drone_battery
                }}
                missionId={selectedMissionData.id}
                replayData={replayData}
                replayShowEvents={replayShowEvents}
              />
            </div>

                        <div style={{ 
              position: "absolute", 
              top: 20, 
              left: 20, 
              right: 20, 
              zIndex: 5,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              pointerEvents: "none"
            }}>
              <div style={{ 
                background: "rgba(11, 18, 32, 0.8)", 
                backdropFilter: "blur(12px)",
                padding: "12px 20px",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
                display: "flex",
                alignItems: "center",
                gap: 16,
                pointerEvents: "auto"
              }}>
                <button 
                  onClick={() => { setSelectedMission(null); setIsReplaying(false); }}
                  style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 4 }}
                >
                  <ArrowLeft size={20} />
                </button>
                <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)" }} />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--muted2)", letterSpacing: "0.05em" }}>Mission Live Feed</div>
                    {!isReplaying && ACTIVE_STATUSES.has(selectedMissionData.status) && (
                      <span style={{ background: "rgba(255, 77, 109, 0.15)", border: "1px solid rgba(255, 77, 109, 0.3)", color: "#ff4d6d", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.1em", animation: "pulse-fast 2s infinite" }}>LIVE</span>
                    )}
                    {isReplaying && (
                      <span style={{ background: "rgba(251, 191, 36, 0.15)", border: "1px solid rgba(251, 191, 36, 0.3)", color: "#fbbf24", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.1em" }}>REPLAY</span>
                    )}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>#{selectedMissionData.id} • {formatDroneName(selectedMissionData.drone_id)}</div>
                </div>
                <div style={{ 
                  padding: "6px 12px", 
                  borderRadius: 8, 
                  background: `${MISSION_STATUS[selectedMissionData.status]?.bg}`,
                  color: MISSION_STATUS[selectedMissionData.status]?.color,
                  border: `1px solid ${MISSION_STATUS[selectedMissionData.status]?.color}44`,
                  fontSize: 12,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  boxShadow: `0 0 12px ${MISSION_STATUS[selectedMissionData.status]?.color}15`
                }}>
                  {MISSION_STATUS[selectedMissionData.status]?.label}
                </div>

                {FINISHED_STATUSES.has(selectedMissionData.status) && !isReplaying && (
                  <button 
                    className="btn btn-primary"
                    onClick={() => setIsReplaying(true)}
                    style={{ marginLeft: 20, display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 10, background: "linear-gradient(135deg, #7c5cff, #a78bfa)", border: "none", boxShadow: "0 4px 15px rgba(124, 92, 255, 0.3)" }}
                  >
                    <History size={16} /> Replay Mission
                  </button>
                )}
              </div>

                            <DynamicReplayMetrics 
                mission={selectedMissionData} 
                isReplaying={isReplaying} 
                replayData={replayData} 
              />
            </div>

                        <div style={{ 
              position: "absolute", 
              bottom: 24, 
              right: 24, 
              width: isReplaying ? 340 : 380,
              maxHeight: "calc(100% - 100px)",
              zIndex: 5,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              pointerEvents: "none",
              transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
            }}>
              <div style={{ pointerEvents: "auto" }}>
                {isReplaying ? (
                  <div style={{ 
                    background: "rgba(11, 18, 32, 0.85)", 
                    backdropFilter: "blur(16px)",
                    borderRadius: 20,
                    border: "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
                    padding: 16
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <History size={18} color="var(--dispatcher-accent)" />
                        <span style={{ fontWeight: 800, fontSize: 16 }}>Mission Replay</span>
                      </div>
                      <button 
                        onClick={() => setIsReplaying(false)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
                      >✕</button>
                    </div>
                    <MissionReplayPanel 
                      missionId={selectedMissionData.id} 
                      onReplayChange={handleReplayChange}
                      integrated={true} 
                    />
                  </div>
                ) : (
                  <MissionDetail mission={selectedMissionData} integrated={true} />
                )}
              </div>
            </div>
          </>
        ) : (
          <div style={{ 
            flex: 1, 
            display: "flex", 
            flexDirection: "column", 
            alignItems: "center", 
            justifyContent: "center",
            background: "var(--bg0)",
            color: "var(--muted2)",
            textAlign: "center",
            padding: 40
          }}>
            <div style={{ 
              width: 80, 
              height: 80, 
              borderRadius: "50%", 
              background: "rgba(255,255,255,0.02)", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              marginBottom: 20,
              border: "1px solid rgba(255,255,255,0.05)"
            }}>
              <Navigation size={40} strokeWidth={1.5} />
            </div>
            <h2 style={{ color: "white", margin: "0 0 8px 0" }}>Select a Mission</h2>
            <p style={{ maxWidth: 300, fontSize: 14 }}>Pick an active flight from the sidebar to view live telemetry and mission pathing.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function FloatingMetric({ label, value, color }) {
  return (
    <div style={{ 
      background: "rgba(11, 18, 32, 0.6)", 
      backdropFilter: "blur(20px)",
      padding: "10px 18px",
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.15)",
      borderTop: "1px solid rgba(255,255,255,0.25)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
      minWidth: 100,
      textAlign: "center"
    }}>
      <div style={{ fontSize: 9, textTransform: "uppercase", color: "rgba(255,255,255,0.6)", fontWeight: 800, marginBottom: 2, letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color: color || "white", textShadow: color ? `0 0 10px ${color}66` : "none" }}>{value}</div>
    </div>
  );
}

function MetricCard({ label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function DynamicReplayMetrics({ mission, isReplaying, replayData }) {
  const [frac, setFrac] = useState(0);

  useEffect(() => {
    if (!isReplaying) return;
    const handleTick = (e) => setFrac(e.detail);
    window.addEventListener('replay-tick', handleTick);
    setFrac(0);
    return () => window.removeEventListener('replay-tick', handleTick);
  }, [isReplaying, replayData]);

  if (!isReplaying || !replayData) {
    return (
      <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
        <FloatingMetric label="Battery" value={`${mission.drone_battery || 0}%`} color={mission.drone_battery < 20 ? "var(--danger)" : "var(--success)"} />
        <FloatingMetric label="Speed" value={`${mission.drone_speed || 0} km/h`} />
        <FloatingMetric label="ETA" value={formatDuration(mission.remaining_duration_h)} />
      </div>
    );
  }

  const getStatsAtFrac = (tFrac) => {
    if (!replayData.keyframes || replayData.keyframes.length === 0) {
      return { distFrac: tFrac, battery: 100, isMoving: true };
    }
    const kfs = replayData.keyframes;
    for (let i = 0; i < kfs.length - 1; i++) {
       if (tFrac >= kfs[i].time_frac && tFrac <= kfs[i+1].time_frac) {
          const tDist = kfs[i+1].time_frac - kfs[i].time_frac;
          if (tDist <= 0.0001) return { distFrac: kfs[i].dist_frac, battery: kfs[i].battery, isMoving: false };
          const ratio = (tFrac - kfs[i].time_frac) / tDist;
          const isMoving = kfs[i+1].dist_frac > kfs[i].dist_frac;
          const b = kfs[i].battery + ratio * (kfs[i+1].battery - kfs[i].battery);
          const d = kfs[i].dist_frac + ratio * (kfs[i+1].dist_frac - kfs[i].dist_frac);
          return { distFrac: d, battery: b, isMoving };
       }
    }
    return { 
      distFrac: kfs[kfs.length - 1].dist_frac, 
      battery: kfs[kfs.length - 1].battery, 
      isMoving: false 
    };
  };

  const { distFrac, battery, isMoving } = getStatsAtFrac(frac);

  const totalKm = replayData.total_route_km || 1;
  const remainingKm = totalKm * (1 - distFrac);
  
  let speed = 0;
  if (isMoving && frac > 0.001 && frac < 0.999) {
      speed = 72 + (Math.random() * 4 - 2); 
  }
  
  const etaMins = (remainingKm / 72) * 60;
  const etaLabel = distFrac >= 0.999 ? "Arrived" : formatDuration(etaMins / 60);

  const battColor = battery < 20 ? "var(--danger)" : battery < 40 ? "#ffd166" : "var(--success)";

  return (
    <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
      <FloatingMetric label="Battery" value={`${Math.max(1, Math.round(battery))}%`} color={battColor} />
      <FloatingMetric label="Speed" value={`${Math.round(speed)} km/h`} />
      <FloatingMetric label="ETA" value={etaLabel} />
    </div>
  );
}

function formatDroneName(id) {
  if (!id) return "Unknown";
  const greek = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon"];
  return `AF-${String(id).padStart(2, '0')} ${greek[(id - 1) % greek.length]}`;
}
