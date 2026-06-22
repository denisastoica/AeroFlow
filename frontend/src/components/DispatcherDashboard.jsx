import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deliveriesAPI, dronesAPI, simulatorAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import ScenarioPanel from "./ScenarioPanel";
import { useDeliveryUpdates } from "../hooks/useDeliveryUpdates";
import { useWebSocketMonitor } from "../hooks/useWebSocketMonitor";
import {
  Play, Pause, Cpu, CheckCircle,
  Activity, Battery, Shield,
  Settings, Trash2, Edit2, Info, Search, MoreVertical, Map, BatteryCharging, History,
  Filter, ArrowUpDown, Power, Wrench,
  PlayCircle, AlertCircle, CheckCircle2,
  Package, LayoutDashboard, Truck, Zap, AlertTriangle
} from "lucide-react";

const STATUS_COLORS = {
  idle: "#33d69f",
  in_mission: "#a78bfa",
  charging: "#ffd166",
  going_to_charging: "#ff9f43",
  low_battery: "#ff4d6d",
  service_required: "#ff4d6d",
  maintenance: "#ff4d6d",
  inactive: "#6b7280",
};

export default function DispatcherDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [batchResult, setBatchResult] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [simPaused, setSimPaused] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [abortingDrone, setAbortingDrone] = useState(null);
  const [resetFleetLoading, setResetFleetLoading] = useState(false);
  const toast = useToast();

  const hasDataRef = useRef(false);
  const fetchData = useCallback(async (isSilent = false) => {
    try {
      if (!hasDataRef.current && !isSilent) setLoading(true);
      const [dashRes, fleetRes] = await Promise.all([
        deliveriesAPI.getDashboardDispatcher(),
        dronesAPI.fleetStatus(),
      ]);
      setDashboard(dashRes.data);
      setFleet(fleetRes.data);
      setError(null);
      hasDataRef.current = true;
    } catch (err) {
      const msg = getErrorMessage(err, "Failed to load dashboard");
      setError(msg);
            if (!hasDataRef.current && !isSilent) {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [toast.error]);

        const { connected: deliveryWs } = useDeliveryUpdates(null);
  const { isConnected: monitorWs } = useWebSocketMonitor(
    (data) => {
      if (data.type === "drone_update") {
        setFleet((prev) => {
          if (!prev || !prev.drones) return prev;
          const drones = prev.drones.map((d) => {
            if (d.id === data.drone_id) {
              return {
                ...d,
                battery: data.battery,
                battery_health: data.battery_health,
                total_flight_km: data.total_flight_km,
                status: data.status,
                mission: data.mission_id ? {
                  ...(d.mission || {}),
                  id: data.mission_id,
                  progress_pct: data.mission_progress_pct,
                  remaining_km: data.mission_remaining_km,
                  status: data.mission_status,
                } : null
              };
            }
            return d;
          });
          return { ...prev, drones };
        });
      }
    },
    null,
    null,
    (data) => {
      if (data.type === "fleet_update" && data.reset_fleet) {
        fetchData(true);
      }
    }
  );

  const isWsConnected = deliveryWs || monitorWs;

  useEffect(() => {
    fetchData();
        const interval = setInterval(fetchData, isWsConnected ? 30000 : 10000);
    return () => clearInterval(interval);
  }, [fetchData, isWsConnected]);

  const handleAssignSingle = async (deliveryId) => {
    try {
      setAssigning(deliveryId);
      await deliveriesAPI.assign(deliveryId);
      await fetchData();
    } catch (err) {
      const msg = getErrorMessage(err, "Assignment failed");
      setError(msg);
      toast.error(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setAssigning(null);
    }
  };

  const handleBatchAssign = async () => {
    try {
      setAssigning("batch");
      setBatchResult(null);
      const res = await deliveriesAPI.batchAssign();
      setBatchResult(res.data);
      await fetchData();
    } catch (err) {
      const msg = getErrorMessage(err, "Batch assignment failed");
      setError(msg);
      toast.error(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setAssigning(null);
    }
  };

  const handleSimToggle = async () => {
    try {
      setSimLoading(true);
      if (simPaused) {
        await simulatorAPI.resume();
        setSimPaused(false);
      } else {
        await simulatorAPI.pause();
        setSimPaused(true);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Simulator control failed"));
    } finally {
      setSimLoading(false);
    }
  };

  const handleAbortMission = async (droneId) => {
    try {
      setAbortingDrone(droneId);
      await simulatorAPI.abortMission(droneId);
      await fetchData();
    } catch (err) {
      toast.error(getErrorMessage(err, "Abort failed"));
    } finally {
      setAbortingDrone(null);
    }
  };

  if (loading && !dashboard) {
    return (
      <div className="stack theme-dispatcher" style={{ maxWidth: "100%", padding: "32px 4vw" }}>
        <div className="page-header">
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <h1 style={{ margin: 0, fontSize: "28px", lineHeight: 1.2 }}>Dispatcher Control Panel</h1>
            <p className="subtle" style={{ margin: "4px 0 0 0", fontSize: "14px" }}>Loading fleet data...</p>
          </div>
        </div>
        <div className="grid grid-6">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton skeleton-stat" />)}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="stack theme-dispatcher" style={{ maxWidth: "100%", padding: "32px 4vw" }}>
      <div className="page-header">
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h1 style={{ margin: 0, fontSize: "28px", lineHeight: 1.2 }}>
            Dispatcher Control Panel
          </h1>
          <p className="subtle" style={{ margin: "4px 0 0 0", fontSize: "14px" }}>
            Fleet management, automatic assignment, and real-time operations.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className={`btn ${simLoading ? "" : simPaused ? "btn-primary" : ""}`}
            type="button"
            onClick={handleSimToggle}
            disabled={simLoading}
            style={!simPaused ? {
              background: "rgba(255,209,102,0.14)",
              borderColor: "rgba(255,209,102,0.3)",
              color: "#ffd166",
            } : undefined}
          >
            {simLoading ? "..." : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {simPaused ? <Play size={14} /> : <Pause size={14} />}
                {simPaused ? "Start Sim" : "Pause Sim"}
              </span>
            )}
          </button>
          <button
            className={`btn ${assigning === "batch" || !dashboard?.deliveries?.pending ? "" : "btn-primary"}`}
            type="button"
            onClick={handleBatchAssign}
            disabled={assigning === "batch" || !dashboard?.deliveries?.pending}
          >
            {assigning === "batch" ? "⌛ Optimizing..." : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cpu size={14} /> Auto Assign
              </span>
            )}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{typeof error === "string" ? error : JSON.stringify(error)}</div>}

      {batchResult && (
        <div className="alert" style={{ background: "rgba(51,214,159,0.1)", borderColor: "rgba(51,214,159,0.25)", color: "#b9ffe6" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <strong>Batch Assignment Result:</strong>
            <button className="btn" type="button" onClick={() => setBatchResult(null)} style={{ padding: "6px 10px" }}>Close</button>
          </div>
          <div style={{ marginTop: 8 }}>{batchResult.message}</div>
          {batchResult.details?.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {batchResult.details.map((detail, index) => (
                <span
                  key={`${detail.delivery_id}-${index}`}
                  className="badge"
                  style={{
                    background: detail.status === "assigned" ? "rgba(51,214,159,0.12)" : "rgba(255,77,109,0.12)",
                    borderColor: detail.status === "assigned" ? "rgba(51,214,159,0.3)" : "rgba(255,77,109,0.3)",
                    color: detail.status === "assigned" ? "#33d69f" : "#ff6b8a",
                  }}
                >
                  #{detail.delivery_id} → {detail.status === "assigned" ? detail.drone_name : (detail.reason || detail.status)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="tab-bar">
        {[
          { key: "overview", label: "Overview", icon: <LayoutDashboard size={14} /> },
          { key: "fleet", label: `Fleet (${fleet?.summary?.total || 0})`, icon: <Truck size={14} /> },
          { key: "pending", label: `Pending (${dashboard?.deliveries?.pending || 0})`, icon: <Package size={14} /> },
          { key: "scenarios", label: "Simulations", icon: <PlayCircle size={14} /> },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`tab-btn${activeTab === tab.key ? " active" : ""}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {dashboard && activeTab === "overview" && <OverviewTab dashboard={dashboard} fleet={fleet} />}
      {fleet && activeTab === "fleet" && <FleetTab fleet={fleet} onAbort={handleAbortMission} abortingDrone={abortingDrone} />}
      {dashboard && activeTab === "pending" && (
        <PendingTab pending={dashboard.urgent_actions.pending_unassigned} assigning={assigning} onAssign={handleAssignSingle} />
      )}
      {activeTab === "scenarios" && (
        <div className="animate-in">
          <ScenarioPanel />
        </div>
      )}
    </div>
  );
}

function OverviewTab({ dashboard, fleet }) {
  const deliveryStats = dashboard.deliveries || {};
  const inTransitCount = (deliveryStats.picking_up || 0) + (deliveryStats.in_transit || 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px", animation: "fadeIn 0.4s ease-out" }}>
            <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", 
        gap: "24px" 
      }}>
        <EnhancedMetricCard label="Total Orders" value={deliveryStats.total || 0} icon={<Package size={24} />} color="#6ae4ff" />
        <EnhancedMetricCard label="Pending Orders" value={deliveryStats.pending || 0} icon={<AlertCircle size={24} />} color="#ffd166" />
        <EnhancedMetricCard label="In Transit" value={inTransitCount} icon={<Truck size={24} />} color="#a78bfa" />
        <EnhancedMetricCard label="Delivered" value={deliveryStats.delivered || 0} icon={<CheckCircle2 size={24} />} color="#33d69f" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))", gap: "24px" }}>
                <div className="card" style={{ padding: "28px", background: "linear-gradient(145deg, rgba(20,26,40,0.6), rgba(10,14,24,0.8))", border: "1px solid rgba(106, 228, 255, 0.15)" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px", fontSize: "18px", color: "#6ae4ff" }}>
            <Activity size={22} /> Delivery Breakdown
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <SmallMetric label="Assigned" value={deliveryStats.assigned || 0} color="#6ae4ff" />
            <SmallMetric label="Confirmed" value={deliveryStats.confirmed || 0} color="#33d69f" />
            <SmallMetric label="Failed" value={deliveryStats.failed || 0} color="#ff4d6d" />
            <SmallMetric label="Cancelled" value={deliveryStats.cancelled || 0} color="#ff9f43" />
          </div>
          <p className="subtle" style={{ marginTop: "24px", fontSize: "12px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "16px" }}>
            Total Orders includes pending, assigned, in transit, delivered, confirmed, failed, and cancelled orders.
          </p>
        </div>

                {fleet && (
          <div className="card" style={{ padding: "28px", background: "linear-gradient(145deg, rgba(20,26,40,0.6), rgba(10,14,24,0.8))", border: "1px solid rgba(167, 139, 250, 0.15)" }}>
            <h3 style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px", fontSize: "18px", color: "#a78bfa" }}>
              <Cpu size={22} /> Drone Fleet Status
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
               <SmallMetric label="Total Drones" value={fleet.summary.total} icon={<Zap size={16} />} color="#a78bfa" />
               <SmallMetric label="Available (Idle)" value={fleet.summary.by_status.idle || 0} color="#33d69f" />
               <SmallMetric label="In Mission" value={fleet.summary.by_status.in_mission || 0} color="#6ae4ff" />
               <SmallMetric label="Charging" value={fleet.summary.by_status.charging || 0} color="#ffd166" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginTop: "24px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "24px" }}>
              <div>
                <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "10px", display: "flex", justifyContent: "space-between" }}>
                  <span>Avg Battery</span>
                  <span style={{ color: "#fff", fontWeight: "800" }}>{fleet.summary.avg_battery}%</span>
                </div>
                <ProgressBar pct={fleet.summary.avg_battery} color={fleet.summary.avg_battery > 50 ? "#33d69f" : fleet.summary.avg_battery > 20 ? "#ffd166" : "#ff4d6d"} />
              </div>
              <div>
                <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "10px", display: "flex", justifyContent: "space-between" }}>
                  <span>Avg Cell Health</span>
                  <span style={{ color: "#fff", fontWeight: "800" }}>{fleet.summary.avg_health}%</span>
                </div>
                <ProgressBar pct={fleet.summary.avg_health} color={fleet.summary.avg_health > 80 ? "#33d69f" : fleet.summary.avg_health > 60 ? "#ffd166" : "#ff4d6d"} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EnhancedMetricCard({ label, value, icon, color }) {
  return (
    <div className="card" style={{ 
      position: "relative", 
      overflow: "hidden", 
      display: "flex", 
      flexDirection: "column", 
      alignItems: "flex-start",
      padding: "24px 28px",
      background: "linear-gradient(145deg, rgba(30,38,56,0.5), rgba(15,20,30,0.8))",
      border: `1px solid ${color}40`,
      boxShadow: `0 8px 32px ${color}15`,
      transition: "transform 0.2s, box-shadow 0.2s"
    }}
    onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 12px 40px ${color}30`; }}
    onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 8px 32px ${color}15`; }}
    >
      <div style={{ position: "absolute", top: "-30px", right: "-30px", width: "120px", height: "120px", background: color, filter: "blur(60px)", opacity: 0.15, borderRadius: "50%", pointerEvents: "none" }} />
      
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
        <div style={{ 
          width: "48px", height: "48px", borderRadius: "14px", 
          background: `${color}15`, border: `1px solid ${color}30`,
          color: color, display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          {icon}
        </div>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </div>
      </div>
      <div style={{ fontSize: "42px", fontWeight: 900, color: "var(--text-bright)", letterSpacing: "-0.02em", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function SmallMetric({ label, value, color, icon }) {
  return (
    <div style={{ 
      background: "rgba(0,0,0,0.25)", 
      border: "1px solid rgba(255,255,255,0.06)", 
      borderRadius: "14px", 
      padding: "16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      transition: "background 0.2s"
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.4)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.25)"; }}
    >
      <div style={{ fontSize: "13px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 800, color: color || "#fff", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

function FleetTab({ fleet, onAbort, abortingDrone }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("default");

  const dronesWithStatus = fleet.drones.map(d => ({
    ...d,
    effectiveStatus: resolveFleetBadgeStatus(d)
  }));

  const filtered = dronesWithStatus.filter(d => {
    if (filter !== "All" && d.effectiveStatus !== filter) return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === "default") {
      const statusRank = { idle: 1, in_mission: 2, charging: 3, low_battery: 4, maintenance: 5, inactive: 6, service_required: 7 };
      if (statusRank[a.effectiveStatus] !== statusRank[b.effectiveStatus]) {
        return statusRank[a.effectiveStatus] - statusRank[b.effectiveStatus];
      }
      return Number(b.battery) - Number(a.battery);
    }
    if (sortBy === "battery_desc") return Number(b.battery) - Number(a.battery);
    if (sortBy === "battery_asc") return Number(a.battery) - Number(b.battery);
    if (sortBy === "range_desc") return Number(b.estimated_range_km || 0) - Number(a.estimated_range_km || 0);
    return 0;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ 
        display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", 
        background: "linear-gradient(145deg, rgba(30,38,56,0.6), rgba(15,20,30,0.8))", 
        padding: "16px 20px", borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)" 
      }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["All", "idle", "in_mission", "charging", "low_battery", "maintenance", "inactive"].map(f => {
            const isActive = filter === f;
            const dotColor = f === "idle" ? "#33d69f" : f === "in_mission" ? "#6ae4ff" : f === "charging" ? "#ffd166" : f === "low_battery" ? "#ff4d6d" : f === "maintenance" ? "#ff4d6d" : f === "inactive" ? "#6b7280" : "transparent";
            const label = f === "All" ? "All" : f === "idle" ? "Available" : f === "in_mission" ? "In Mission" : f === "charging" ? "Charging" : f === "low_battery" ? "Low Battery" : f === "maintenance" ? "Maintenance" : "Inactive";
            return (
              <button 
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                  background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                  color: isActive ? "#fff" : "var(--muted)",
                  border: `1px solid ${isActive ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)"}`,
                  cursor: "pointer", transition: "all 0.2s"
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)" }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent" }}
              >
                {f !== "All" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />}
                {label}
              </button>
            )
          })}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <input 
              type="text" 
              placeholder="Search drone..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              style={{ 
                padding: "8px 12px 8px 36px", width: 220, borderRadius: 8, 
                background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)",
                color: "#fff", fontSize: 13, outline: "none"
              }} 
            />
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}>
              <Search size={14} />
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <select 
              value={sortBy} 
              onChange={e => setSortBy(e.target.value)}
              style={{ 
                padding: "8px 12px 8px 32px", borderRadius: 8,
                background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)",
                color: "#fff", fontSize: 13, outline: "none", cursor: "pointer"
              }}
            >
              <option value="default" style={{background: "#0f141e"}}>Sort: Operational Priority</option>
              <option value="battery_desc" style={{background: "#0f141e"}}>Battery: High to Low</option>
              <option value="battery_asc" style={{background: "#0f141e"}}>Battery: Low to High</option>
              <option value="range_desc" style={{background: "#0f141e"}}>Range: High to Low</option>
            </select>
            <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }}>
              <ArrowUpDown size={14} />
            </div>
          </div>
        </div>
      </div>
      
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {filtered.map((drone) => (
          <DroneCard key={drone.id} drone={drone} onAbort={onAbort} abortingDrone={abortingDrone} />
        ))}
      </div>
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)", background: "rgba(255,255,255,0.02)", borderRadius: 12 }}>
          <Info size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
          <div>No drones found matching your criteria.</div>
        </div>
      )}
    </div>
  );
}

function DroneCard({ drone, onAbort, abortingDrone }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [showMenu, setShowMenu] = useState(false);
  const [sendingToCharge, setSendingToCharge] = useState(false);

  const effectiveStatus = resolveFleetBadgeStatus(drone);
  const borderColor = STATUS_COLORS[effectiveStatus] || "rgba(255,255,255,0.2)";
  const statusLabelsEn = {
    idle: "AVAILABLE",
    in_mission: "IN MISSION",
    charging: "CHARGING",
    low_battery: "NEEDS CHARGE",
    service_required: "SERVICE REQUIRED",
    maintenance: "MAINTENANCE",
    inactive: "INACTIVE",
  };

  const formatRange = (range) => {
    if (range == null) return "N/A";
    const r = Number(range);
    if (r <= 0.05) return "Unavailable";
    if (r < 10) return `${r.toFixed(1)} km`;
    return `${Math.round(r)} km`;
  };

  const handleSendToCharge = async () => {
    setShowMenu(false);
    try {
      setSendingToCharge(true);
      await dronesAPI.sendToCharge(drone.id);
      toast.success(`${drone.name} is heading to the nearest charging station.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to send to charge"));
    } finally {
      setSendingToCharge(false);
    }
  };

  const isChargeDisabled = sendingToCharge || effectiveStatus === "charging" || effectiveStatus === "in_mission" || (Number(drone.estimated_range_km) <= 0.05);

  return (
    <div className="card" style={{ borderLeft: `4px solid ${borderColor}` }}>
      <div className="card-body" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{drone.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge" style={{ background: `${borderColor}22`, borderColor, color: effectiveStatus === "charging" ? "#ffd166" : borderColor, fontSize: 10 }}>
              {statusLabelsEn[effectiveStatus] || effectiveStatus.toUpperCase()}
            </span>
            <div style={{ position: "relative" }}>
              <button 
                onClick={() => setShowMenu(!showMenu)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <MoreVertical size={16} />
              </button>
              {showMenu && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setShowMenu(false)} />
                  <div style={{ 
                    position: "absolute", top: "100%", right: 0, zIndex: 20, marginTop: 8,
                    background: "#1e2638", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)", minWidth: 180, overflow: "hidden"
                  }}>
                    <button onClick={() => navigate("/map", { state: { selectedDroneId: drone.id } })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", width: "100%", background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 13, textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <Map size={14} color="#6ae4ff" /> View on map
                    </button>
                    <button onClick={handleSendToCharge} disabled={isChargeDisabled} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", width: "100%", background: "transparent", border: "none", color: "#fff", cursor: isChargeDisabled ? "not-allowed" : "pointer", fontSize: 13, textAlign: "left", opacity: isChargeDisabled ? 0.4 : 1, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <BatteryCharging size={14} color="#ffd166" /> {sendingToCharge ? "Sending..." : "Send to charge"}
                    </button>
                    <button onClick={() => navigate("/deliveries", { state: { droneId: drone.id } })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", width: "100%", background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 13, textAlign: "left" }}>
                      <History size={14} color="#a78bfa" /> View mission history
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>Battery: <strong>{typeof drone.battery === 'number' ? drone.battery.toFixed(1) : drone.battery}%</strong></span>
            <span className="subtle">Range: {formatRange(drone.estimated_range_km)}</span>
          </div>
          <ProgressBar pct={drone.battery} color={drone.battery > 50 ? "#33d69f" : drone.battery > 20 ? "#ffd166" : "#ff4d6d"} />

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 8, marginBottom: 4 }}>
            <span>Health: <strong>{drone.battery_health}%</strong></span>
            <span className="subtle">{drone.total_charge_cycles} cycles</span>
          </div>
          <ProgressBar pct={drone.battery_health} color={drone.battery_health > 80 ? "#33d69f" : drone.battery_health > 60 ? "#ffd166" : "#ff4d6d"} />
        </div>

        <div className="subtle" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 10 }}>
          <span>{drone.total_flight_km} km flown</span>
          <span>Efficiency: {(drone.motor_efficiency * 100).toFixed(0)}%</span>
        </div>

        {drone.mission && (
          <div className="card" style={{ boxShadow: "none", background: "rgba(106,228,255,0.03)", borderColor: "rgba(106,228,255,0.1)" }}>
            <div className="card-body" style={{ padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>Mission #{drone.mission.id}</div>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => onAbort && onAbort(drone.id)}
                  disabled={abortingDrone === drone.id}
                  style={{
                    padding: "2px 8px",
                    fontSize: 10,
                    background: "rgba(255,77,109,0.12)",
                    borderColor: "rgba(255,77,109,0.3)",
                    color: "#ff6b8a",
                  }}
                >
                  {abortingDrone === drone.id ? "..." : "Abort"}
                </button>
              </div>
              <ProgressBar pct={drone.mission.progress_pct} color="#6ae4ff" />
              <div className="subtle" style={{ marginTop: 6, fontSize: 11 }}>
                Progress: {typeof drone.mission.progress_pct === "number" ? drone.mission.progress_pct.toFixed(1) : drone.mission.progress_pct}% · {typeof drone.mission.remaining_km === "number" ? drone.mission.remaining_km.toFixed(1) : drone.mission.remaining_km} km remaining
              </div>
            </div>
          </div>
        )}

        {drone.delivery && (
          <div style={{ marginTop: 10 }}>
            <span className="badge" style={{ color: "#fff", background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", fontSize: 10 }}>
              <Package size={10} style={{ marginRight: 4 }} /> Order #{drone.delivery.id} · {drone.delivery.package_type}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingTab({ pending, assigning, onAssign }) {
  const [scoresMap, setScoresMap] = useState({});
  const [loadingScores, setLoadingScores] = useState(null);

  const toggleScores = async (deliveryId) => {
    if (scoresMap[deliveryId]) {
      setScoresMap((prev) => {
        const next = { ...prev };
        delete next[deliveryId];
        return next;
      });
      return;
    }
    try {
      setLoadingScores(deliveryId);
      const res = await deliveriesAPI.getDroneScores(deliveryId);
      setScoresMap((prev) => ({ ...prev, [deliveryId]: res.data }));
    } catch {
          } finally {
      setLoadingScores(null);
    }
  };

  if (!pending.length) {
    return (
      <div className="card" style={{ padding: 60, textAlign: "center" }}>
        <div style={{ background: 'rgba(51,214,159,0.1)', color: '#33d69f', width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
          <CheckCircle size={32} />
        </div>
        <h3 style={{ margin: 0 }}>All orders have been assigned!</h3>
        <p className="subtle">No new pending deliveries.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
      {pending.map((delivery) => {
        const scoreData = scoresMap[delivery.id];
        return (
          <div key={delivery.id} className="card">
            <div className="card-body" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 16 }}>Order #{delivery.id}</span>
                {delivery.priority && <PriorityBadge priority={delivery.priority} />}
              </div>
              <div className="subtle" style={{ display: "grid", gap: 6, marginBottom: 16, fontSize: 13 }}>
                <div>Distance: <strong>{delivery.distance_km?.toFixed(1) || "?"} km</strong></div>
                <div>Customer: <strong>{delivery.customer_name || `#${delivery.customer_id}`}</strong></div>
                <div>Weight: <strong>{delivery.weight_kg} kg</strong></div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className={`btn ${assigning === delivery.id ? "" : "btn-primary"}`} type="button" onClick={() => onAssign(delivery.id)} disabled={assigning === delivery.id} style={{ flex: 1 }}>
                  {assigning === delivery.id ? "Assigning..." : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                      <Zap size={14} /> Assign Best Drone
                    </span>
                  )}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => toggleScores(delivery.id)}
                  disabled={loadingScores === delivery.id}
                  style={{ padding: "8px 12px", fontSize: 12 }}
                  title="View drone scores"
                >
                  {loadingScores === delivery.id ? "..." : scoreData ? <Trash2 size={14} /> : <Activity size={14} />}
                </button>
              </div>
              {scoreData && scoreData.scores?.length > 0 && (
                <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--accent)" }}>
                    Drone Ranking ({scoreData.scores.length} candidates)
                  </div>
                  {scoreData.scores.map((s, i) => (
                    <div key={s.drone_id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                      borderBottom: i < scoreData.scores.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: "50%", display: "flex",
                        alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800,
                        background: i === 0 ? "rgba(51,214,159,0.18)" : "rgba(255,255,255,0.06)",
                        color: i === 0 ? "#33d69f" : "inherit",
                        border: i === 0 ? "1px solid rgba(51,214,159,0.3)" : "1px solid transparent",
                      }}>
                        {i + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{s.drone_name}</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }} className="subtle">
                          <span>dist. to pickup: {s.dist_to_pickup_km} km</span>
                          <span>charging stops: {s.charging_stops ?? 0}</span>
                          <span>battery: {s.battery}%</span>
                          {!s.weather_ok && <span style={{ color: "#ff6b8a" }}>Unfavorable weather</span>}
                        </div>
                      </div>
                      <div style={{
                        fontWeight: 900,
                        fontSize: 13,
                        color: i === 0 ? "#33d69f" : "var(--muted)",
                        textAlign: "right"
                      }}>
                        {i === 0 ? "Best" : `#${i + 1}`}
                        <div style={{ fontSize: 10, color: "var(--muted2)", fontWeight: 600 }}>
                          cost {Number(s.score).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {scoreData && scoreData.scores?.length === 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#ff6b8a", textAlign: "center", padding: 10, background: "rgba(255,77,109,0.05)", borderRadius: 8 }}>
                  <AlertTriangle size={14} style={{ marginRight: 6 }} /> No drones available for this delivery.
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProgressBar({ pct, color }) {
  return (
    <div className="progress-bar">
      <div className="fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}

function BatteryIndicator({ pct }) {
  const color = pct > 60 ? "#33d69f" : pct > 30 ? "#ffd166" : "#ff4d6d";
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 4px ${color}` }} />;
}

function HealthIndicator({ pct }) {
  const color = pct > 80 ? "#33d69f" : pct > 60 ? "#ffd166" : "#ff4d6d";
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 4px ${color}` }} />;
}

function PriorityBadge({ priority }) {
  const styles = {
    normal: { background: "rgba(255,255,255,0.08)", color: "#adb5bd", borderColor: "rgba(255,255,255,0.12)", label: "Standard", icon: "📦" },
    urgent: { background: "rgba(255,209,102,0.15)", color: "#ffd166", borderColor: "rgba(255,209,102,0.4)", label: "Urgent", icon: "⚡" },
    emergency: { background: "rgba(255,77,109,0.18)", color: "#ff4d6d", borderColor: "rgba(255,77,109,0.5)", label: "Emergency", icon: "🚨" },
  };
  const style = styles[priority] || styles.normal;
  return (
    <span className="badge" style={style}>
      {style.label}
    </span>
  );
}

function resolveFleetBadgeStatus(drone) {
  if (drone.status === "inactive") return "inactive";
  if (drone.status === "maintenance") return "maintenance";
  if (Number(drone.estimated_range_km) <= 0.05) {
    return "service_required";
  }
  if (["charging", "going_to_charging"].includes(drone.status) || drone.mission?.status === "charging") {
    return "charging";
  }
  if (drone.mission || drone.delivery || drone.status === "in_mission") {
    return "in_mission";
  }
  if (Number(drone.battery) < 20) {
    return "low_battery";
  }
  return "idle";
}
