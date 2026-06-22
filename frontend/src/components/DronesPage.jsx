import React, { useCallback, useEffect, useRef, useState } from "react";
import DroneDetail from "./DroneDetail";
import { dronesAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../context/AuthContext";
import { useWebSocketMonitor } from "../hooks/useWebSocketMonitor";
import { 
  Plane, Activity, Battery, Shield, 
  Settings, Trash2, Edit2, Info, 
  Filter, ArrowUpDown, Power, Wrench, 
  PlayCircle, AlertCircle, CheckCircle2,
  MoreVertical, Search, AlertTriangle,
  X, Plus, Smartphone, Cpu, ShieldCheck
} from "lucide-react";

export default function DronesPage() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isDispatcher = user?.role === "dispatcher";
  
  const toastRef = useRef(toast);
  toastRef.current = toast;
  
  const [fleet, setFleet] = useState(null);
  const [selectedDrone, setSelectedDrone] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [showModal, setShowModal] = useState(false);
  const [editingDrone, setEditingDrone] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    status: "idle",
    battery_health: 100,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(null);

    const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("id");
  const [sortOrder, setSortOrder] = useState("asc");
  const [quickFilter, setQuickFilter] = useState("all");

  const OPTIMAL_BATTERY_THRESHOLD = 30;
  const OPTIMAL_HEALTH_THRESHOLD = 80;
  const SEVERE_HEALTH_THRESHOLD = 70;
  const MAX_PACKAGE_WEIGHT_KG = 3;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const f = await dronesAPI.fleetStatus();
      setFleet(f.data);
    } catch (e) {
      toastRef.current.error(getErrorMessage(e, "Could not load fleet"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useWebSocketMonitor(
    (update) => {
      if (!update?.drone_id) return;

      setFleet((prev) => {
        if (!prev?.drones?.length) return prev;

        let changed = false;
        const drones = prev.drones.map((d) => {
          if (d.id !== update.drone_id) return d;
          changed = true;
          return {
            ...d,
            status: update.status ?? d.status,
            battery: update.battery ?? d.battery,
            battery_health: update.battery_health ?? d.battery_health,
            estimated_range_km: update.estimated_range_km ?? d.estimated_range_km,
            total_flight_km: update.total_flight_km ?? d.total_flight_km,
            total_charge_cycles: update.total_charge_cycles ?? d.total_charge_cycles,
            latitude: update.latitude ?? d.latitude,
            longitude: update.longitude ?? d.longitude,
          };
        });

        if (!changed) return prev;
        return { ...prev, drones };
      });

      setSelectedDrone((prev) => {
        if (!prev || prev.id !== update.drone_id) return prev;
        return {
          ...prev,
          status: update.status ?? prev.status,
          battery: update.battery ?? prev.battery,
          battery_health: update.battery_health ?? prev.battery_health,
          estimated_range_km: update.estimated_range_km ?? prev.estimated_range_km,
          total_flight_km: update.total_flight_km ?? prev.total_flight_km,
          total_charge_cycles: update.total_charge_cycles ?? prev.total_charge_cycles,
          latitude: update.latitude ?? prev.latitude,
          longitude: update.longitude ?? prev.longitude,
        };
      });
    },
    null,
    null,
    (evt) => {
            if (evt?.type === "fleet_update") {
        load();
      }
    }
  );

  const handleOpenModal = (drone = null) => {
    if (drone) {
      setEditingDrone(drone);
      setFormData({
        name: drone.name,
        status: drone.status,
        battery_health: drone.battery_health,
      });
    } else {
      setEditingDrone(null);
      setFormData({
        name: "",
        status: "idle",
        battery_health: 100,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editingDrone) {
        await dronesAPI.update(editingDrone.id, formData);
        toast.success("Drone configuration updated");
      } else {
        await dronesAPI.create(formData);
        toast.success("New drone added to fleet");
      }
      load();
      setShowModal(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Error saving drone"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickStatus = async (droneId, newStatus) => {
    try {
      await dronesAPI.update(droneId, { status: newStatus });
      toast.success(`Drone status updated to ${newStatus}`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to update status"));
    }
  };

  const handleReturnToService = async (droneId) => {
    try {
      await dronesAPI.returnToService(droneId);
      toast.success("Drone returned to service");
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not return drone to service"));
    }
  };

  const handleSendToCharge = async (droneId) => {
    try {
      await dronesAPI.sendToCharge(droneId);
      toast.success("Drone sent to charging station");
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not send drone to charge"));
    }
  };

  const handleDelete = async () => {
    if (!showConfirmDelete) return;
    try {
      await dronesAPI.delete(showConfirmDelete.id);
      toast.success("Drone retired from active fleet operations");
      setShowConfirmDelete(null);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not retire drone"));
    }
  };

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortOrder("desc");
    }
  };

  const isAvailableDrone = (drone) => drone.status === "idle";
  const isOptimalReadyDrone = (drone) => (
    isAvailableDrone(drone) &&
    drone.battery >= OPTIMAL_BATTERY_THRESHOLD &&
    drone.battery_health >= OPTIMAL_HEALTH_THRESHOLD
  );
  const isServiceRequiredDrone = (drone) => drone.status === "maintenance";
  const isAttentionDrone = (drone) => (
    drone.battery < OPTIMAL_BATTERY_THRESHOLD ||
    drone.battery_health < OPTIMAL_HEALTH_THRESHOLD ||
    isServiceRequiredDrone(drone)
  );

  const fleetDrones = fleet?.drones || [];
  const availableCount = fleetDrones.filter(isAvailableDrone).length;
  const optimalReadyCount = fleetDrones.filter(isOptimalReadyDrone).length;
  const inMissionCount = fleetDrones.filter((d) => d.status === "in_mission").length;
  const lowBatteryCount = fleetDrones.filter((d) => d.battery < OPTIMAL_BATTERY_THRESHOLD).length;
  const healthWatchCount = fleetDrones.filter((d) => d.status !== "maintenance" && d.battery_health < OPTIMAL_HEALTH_THRESHOLD).length;
  const serviceRequiredCount = fleetDrones.filter(isServiceRequiredDrone).length;
  const attentionCount = fleetDrones.filter(isAttentionDrone).length;

  const filteredDrones = fleetDrones
    .filter(d => {
      const matchesSearch = d.name.toLowerCase().includes(search.toLowerCase()) || d.id.toString().includes(search);
      const matchesStatus = statusFilter === "all" || d.status === statusFilter;
      
      let matchesQuick = true;
      if (quickFilter === 'available') matchesQuick = isAvailableDrone(d);
      if (quickFilter === 'optimal') matchesQuick = isOptimalReadyDrone(d);
      if (quickFilter === 'mission') matchesQuick = d.status === 'in_mission';
      if (quickFilter === 'attention') matchesQuick = isAttentionDrone(d);
      
      return matchesSearch && matchesStatus && matchesQuick;
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

  if (loading && !fleet) {
    return (
      <div className="stack theme-admin">
        <div className="page-header">
          <div>
            <h1>Drone Fleet</h1>
            <p className="subtle">Loading technical data...</p>
          </div>
        </div>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );
  }

  const STATUS_CONFIG = {
    idle: { label: "AVAILABLE", color: "#33d69f", icon: <CheckCircle2 size={12} />, desc: "Ready for assignment" },
    in_mission: { label: "IN MISSION", color: "#6ae4ff", icon: <Activity size={12} />, desc: "Currently active" },
    charging: { label: "CHARGING", color: "#ffd166", icon: <Battery size={12} />, desc: "Docked at station" },
    going_to_charging: { label: "GOING TO CHARGE", color: "#ffd166", icon: <PlayCircle size={12} />, desc: "Relocating to charging station" },
    maintenance: { label: "SERVICE REQUIRED", color: "#ff4d6d", icon: <Wrench size={12} />, desc: "Maintenance required before missions" },
    inactive: { label: "INACTIVE", color: "#adb5bd", icon: <Power size={12} />, desc: "Stored / Disabled" }
  };

  return (
    <div className="stack theme-admin">
      <div className="page-header">
        <div style={{ marginLeft: -24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Plane size={32} color="var(--primary)" style={{ flexShrink: 0, marginTop: 4 }} />
            <div>
              <h1 style={{ margin: 0 }}>Fleet Management</h1>
              <p className="subtle" style={{ margin: 0, marginTop: 4 }}>Technical status, health monitoring, and maintenance logs.</p>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" className="btn btn-icon" onClick={() => window.location.href='/settings'} title="Fleet & Maintenance Settings">
            <Settings size={18} className={loading ? "spin" : ""} />
            <span style={{ fontSize: 13, marginLeft: 8 }}>Fleet Settings</span>
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => handleOpenModal()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={18} /> Add New Asset
            </button>
          )}
        </div>
      </div>

            {fleet?.summary && (
        <div className="grid" style={{ gap: 16, marginBottom: 24, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <StatBox 
            label="Total Fleet" 
            value={fleet.summary.total} 
            subValue={`${fleet.summary.total} total drones`}
            icon={null} 
            onClick={() => setQuickFilter('all')}
            active={quickFilter === 'all'}
          />
          <StatBox 
            label="Available Fleet" 
            value={availableCount} 
            subValue={`${availableCount} status AVAILABLE`}
            icon={null} 
            color="#33d69f" 
            onClick={() => setQuickFilter('available')}
            active={quickFilter === 'available'}
          />
          <StatBox 
            label="Optimal Ready" 
            value={optimalReadyCount} 
            subValue={`AVAILABLE + battery >= ${OPTIMAL_BATTERY_THRESHOLD}% + health >= ${OPTIMAL_HEALTH_THRESHOLD}%`}
            icon={null} 
            color="#56f0b7" 
            onClick={() => setQuickFilter('optimal')}
            active={quickFilter === 'optimal'}
          />
          <StatBox 
            label="In Mission" 
            value={inMissionCount} 
            subValue={`${inMissionCount} currently active`}
            icon={null} 
            color="#6ae4ff" 
            onClick={() => setQuickFilter('mission')}
            active={quickFilter === 'mission'}
          />
          <StatBox 
            label="Requiring Attention" 
            value={attentionCount} 
            subValue={`${lowBatteryCount} needs charge, ${healthWatchCount} health watch, ${serviceRequiredCount} service required`}
            icon={null} 
            color="#ff4d6d" 
            onClick={() => setQuickFilter('attention')}
            active={quickFilter === 'attention'}
            isCritical={attentionCount > 0}
          />
        </div>
      )}

            <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body" style={{ display: "flex", gap: 16, alignItems: "center", padding: '16px 20px' }}>
          <div style={{ flex: 1, position: "relative" }}>
             <Search size={16} className="subtle" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
             <input 
              type="text" 
              placeholder="Search by drone name or ID..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "10px 12px 10px 40px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)", color: "#fff" }}
            />
          </div>
          
          <div className="quick-filters-group">
            <button className={`q-filter ${quickFilter === 'all' ? 'active' : ''}`} onClick={() => setQuickFilter('all')}>All</button>
            <button className={`q-filter ${quickFilter === 'available' ? 'active' : ''}`} onClick={() => setQuickFilter('available')}>Available</button>
            <button className={`q-filter ${quickFilter === 'optimal' ? 'active' : ''}`} onClick={() => setQuickFilter('optimal')}>Optimal</button>
            <button className={`q-filter ${quickFilter === 'mission' ? 'active' : ''}`} onClick={() => setQuickFilter('mission')}>In Mission</button>
            <button className={`q-filter ${quickFilter === 'attention' ? 'active' : ''}`} onClick={() => setQuickFilter('attention')}>Attention</button>
          </div>

          <select 
            className="select-input" 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px' }}
          >
            <option value="all">Status Filter</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

            <div className="card" style={{ overflow: "hidden" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort("name")} style={{ cursor: "pointer" }}>
                Drone Name <ArrowUpDown size={12} className="subtle" />
              </th>
              <th>Status</th>
              <th onClick={() => toggleSort("battery")} style={{ cursor: "pointer", textAlign: "right" }}>
                Battery <ArrowUpDown size={12} className="subtle" />
              </th>
              <th onClick={() => toggleSort("battery_health")} style={{ cursor: "pointer", textAlign: "right" }}>
                Health <ArrowUpDown size={12} className="subtle" />
              </th>
              <th onClick={() => toggleSort("estimated_range_km")} style={{ cursor: "pointer", textAlign: "right" }}>
                Range <ArrowUpDown size={12} className="subtle" />
              </th>
              <th style={{ textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredDrones.map((d) => {
              const isLowBattery = d.battery < OPTIMAL_BATTERY_THRESHOLD;
              const isLowHealth = d.battery_health < OPTIMAL_HEALTH_THRESHOLD;
              const needsAttention = isLowBattery || isLowHealth || d.status === 'maintenance';
              const needsCharge = d.battery < OPTIMAL_BATTERY_THRESHOLD && !['charging', 'going_to_charging'].includes(d.status);
              const serviceRequired = isServiceRequiredDrone(d);
              const healthWatch = d.status !== 'maintenance' && d.battery_health < OPTIMAL_HEALTH_THRESHOLD;
              const isManualMaintenance = d.status === 'maintenance' && d.maintenance_source === 'manual';
              const canSendToCharge = needsCharge && d.status === 'idle';
              const canSendToMaintenance = healthWatch && d.status !== 'maintenance';

              return (
                <tr key={d.id} className={needsAttention ? 'row-attention' : ''}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className={`drone-icon-circle ${needsAttention ? 'warn' : ''}`}>
                         <Plane size={14} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{d.name}</div>
                        <div className="subtle" style={{ fontSize: 11, fontWeight: 500 }}>
                          UID: {d.id} · {MAX_PACKAGE_WEIGHT_KG}kg payload max
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="status-badge" style={{ background: `${STATUS_CONFIG[d.status]?.color}15`, color: STATUS_CONFIG[d.status]?.color, borderColor: `${STATUS_CONFIG[d.status]?.color}33` }}>
                      {STATUS_CONFIG[d.status]?.icon}
                      {STATUS_CONFIG[d.status]?.label}
                    </div>
                    {needsCharge && (
                      <div className="attention-label">NEEDS CHARGE</div>
                    )}
                    {!needsCharge && serviceRequired && (
                      <div className="attention-label">SERVICE REQUIRED</div>
                    )}
                    {!needsCharge && !serviceRequired && healthWatch && (
                      <div className="attention-label attention-label-health">HEALTH WATCH</div>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="battery-v-group">
                       <div className="battery-pct" style={{ color: d.battery > 40 ? "#33d69f" : d.battery > 20 ? "#ffd166" : "#ff4d6d" }}>
                        {d.battery?.toFixed(1)}%
                       </div>
                       <div className="battery-mini-bar">
                          <div className="fill" style={{ width: `${d.battery}%`, background: d.battery > 40 ? "#33d69f" : d.battery > 20 ? "#ffd166" : "#ff4d6d" }} />
                       </div>
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                     <div style={{ fontWeight: 700, color: isLowHealth ? '#ff4d6d' : 'inherit' }}>{d.battery_health?.toFixed(1)}%</div>
                     <div className="subtle" style={{ fontSize: 10, fontWeight: 500 }}>{d.total_charge_cycles} cycles</div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{d.estimated_range_km?.toFixed(1)} km</div>
                    <div className="subtle" style={{ fontSize: 10, fontWeight: 500 }}>{d.total_flight_km?.toFixed(0)} km total</div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button className="icon-btn" title="View Technical Details" onClick={() => setSelectedDrone(d)}>
                        <Info size={16} />
                      </button>
                      {(isAdmin || isDispatcher) && canSendToCharge && (
                        <button className="icon-btn" title="Send to Charge" onClick={() => handleSendToCharge(d.id)}>
                          <Battery size={16} />
                        </button>
                      )}
                      {(isAdmin || isDispatcher) && canSendToMaintenance && (
                        <button className="icon-btn" title="Send to Maintenance" onClick={() => handleQuickStatus(d.id, "maintenance")}>
                          <Wrench size={16} />
                        </button>
                      )}
                      {(isAdmin || isDispatcher) && isManualMaintenance && (
                        <button className="icon-btn" title="Return to service" onClick={() => handleReturnToService(d.id)}>
                          <CheckCircle2 size={16} />
                        </button>
                      )}
                      {(isAdmin || isDispatcher) && !canSendToCharge && !canSendToMaintenance && !isManualMaintenance && (
                        <button className="icon-btn" title="Flag for Maintenance" onClick={() => handleQuickStatus(d.id, "maintenance")}>
                          <Wrench size={16} />
                        </button>
                      )}
                      {isAdmin && (
                        <button 
                          className="icon-btn danger" 
                          title={['in_mission', 'going_to_charging'].includes(d.status) ? "Cannot retire drone while it is active" : "Retire asset"} 
                          onClick={() => setShowConfirmDelete(d)}
                          disabled={['in_mission', 'going_to_charging'].includes(d.status)}
                          style={{ opacity: ['in_mission', 'going_to_charging'].includes(d.status) ? 0.3 : 1 }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content animate-pop" style={{ maxWidth: 460, padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header-premium">
              <div style={{ paddingRight: 24 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{editingDrone ? "Update Asset" : "New Fleet Asset"}</h2>
                <p className="subtle" style={{ margin: '2px 0 0 0', fontSize: 12 }}>
                  {editingDrone ? "Modify existing drone parameters and status" : "Register a new drone in the fleet and define its initial state"}
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body-premium stack" style={{ gap: 24, padding: '24px 28px', maxHeight: '75vh', overflowY: 'auto' }}>
                            <div className="form-section">
                <div className="section-header">
                  <Smartphone size={16} />
                  <span>Asset Information</span>
                </div>
                <div className="form-grid-premium">
                  <div className="form-group-premium">
                    <label>Fleet Asset Name</label>
                    <input 
                      type="text" 
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      required
                      placeholder="e.g. Aero-01"
                      className="input-premium"
                    />
                  </div>
                </div>
              </div>

                            <div className="form-section">
                <div className="section-header">
                  <ShieldCheck size={16} />
                  <span>Operational State</span>
                </div>
                <div className="form-group-premium">
                  <label style={{ marginBottom: 12 }}>Initial Status</label>
                  <div className="status-selection-grid">
                    {Object.entries(STATUS_CONFIG)
                      .filter(([k]) => ['idle', 'maintenance', 'inactive'].includes(k))
                      .map(([k, v]) => (
                        <div 
                          key={k} 
                          className={`status-card-premium ${formData.status === k ? 'active' : ''}`}
                          onClick={() => setFormData({...formData, status: k})}
                        >
                          <div className="status-card-icon" style={{ color: v.color }}>{v.icon}</div>
                          <div className="status-card-info">
                            <div className="status-card-label">{v.label}</div>
                            <div className="status-card-desc">{v.desc}</div>
                          </div>
                          {formData.status === k && <div className="status-card-check"><CheckCircle2 size={14} /></div>}
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="modal-footer-premium">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ padding: '12px 24px' }} disabled={isSubmitting}>
                  {isSubmitting ? "Processing..." : editingDrone ? "Update Configuration" : "Register Asset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConfirmDelete && (
        <div className="modal-overlay" onClick={() => setShowConfirmDelete(null)}>
          <div className="modal-content animate-pop" style={{ maxWidth: 400, padding: 32, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ 
              width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,77,109,0.1)',
              color: '#ff4d6d',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto'
            }}>
              <Trash2 size={32} />
            </div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20 }}>Retire this drone?</h3>
            <p className="subtle" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
              The asset will be removed from active fleet operations, but historical missions will remain available for <strong>{showConfirmDelete.name}</strong>.
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setShowConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleDelete}>Retire</button>
            </div>
          </div>
        </div>
      )}

      {selectedDrone && (
        <div className="delivery-detail-modal-bg">
          <DroneDetail drone={selectedDrone} onClose={() => setSelectedDrone(null)} />
        </div>
      )}

      <style>{`
        .modal-header-premium {
          padding: 20px 28px;
          background: rgba(255,255,255,0.02);
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          position: relative;
        }
        .modal-close-btn {
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(255,255,255,0.05); border: none;
          color: rgba(255,255,255,0.4); display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s;
        }
        .modal-close-btn:hover {
          background: rgba(255,77,109,0.1); color: #ff4d6d; transform: rotate(90deg);
        }
        
        .form-section { display: flex; flex-direction: column; gap: 16px; }
        .section-header {
          display: flex; alignItems: center; gap: 10px;
          font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em;
          color: var(--primary); opacity: 0.8;
        }
        
        .form-grid-premium { display: flex; flex-direction: column; gap: 20px; }
        .form-group-premium { display: flex; flex-direction: column; gap: 10px; }
        .form-group-premium label { font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.7); }
        
        .input-premium {
          background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 10px 14px; color: #fff; font-size: 13px;
          transition: all 0.2s;
        }
        .input-premium:focus {
          border-color: var(--primary); background: rgba(106, 228, 255, 0.05); outline: none;
          box-shadow: 0 0 0 4px rgba(106, 228, 255, 0.1);
        }
        
        
        .status-selection-grid { display: flex; flex-direction: column; gap: 10px; }
        .status-card-premium {
          display: flex; align-items: center; gap: 12px; padding: 12px 14px;
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
          border-radius: 14px; cursor: pointer; transition: all 0.2s; position: relative;
        }
        .status-card-premium:hover {
          background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1);
        }
        .status-card-premium.active {
          background: rgba(106, 228, 255, 0.05); border-color: var(--primary);
        }
        .status-card-icon { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }
        .status-card-label { font-size: 13px; font-weight: 800; color: #fff; }
        .status-card-desc { font-size: 11px; color: rgba(255,255,255,0.4); font-weight: 500; }
        .status-card-check { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); color: var(--primary); }
        
        .modal-footer-premium {
          margin-top: 4px; display: flex; justify-content: flex-end; gap: 12px;
          border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px;
        }
        .btn-ghost { background: transparent; border: 1px solid transparent; color: rgba(255,255,255,0.4); font-weight: 700; }
        .btn-ghost:hover { background: rgba(255,255,255,0.05); color: #fff; }

        .stat-card { 
          cursor: pointer; transition: all 0.2s; border: 1px solid rgba(255,255,255,0.05);
        }
        .stat-card:hover { transform: translateY(-2px); background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); }
        .stat-card.active { border-color: var(--primary); background: rgba(106, 228, 255, 0.05); }
        .stat-card.critical { border-left: 3px solid #ff4d6d; }
        
        .stat-sub { font-size: 11px; opacity: 0.5; font-weight: 500; margin-top: 4px; }
        .stat-value { font-size: 24px; font-weight: 800; line-height: 1; }

        .quick-filters-group {
          display: flex; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .q-filter {
          background: transparent; border: none; color: rgba(255,255,255,0.4);
          padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
          border-radius: 6px; transition: all 0.2s;
        }
        .q-filter:hover { color: #fff; }
        .q-filter.active { background: rgba(255,255,255,0.08); color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }

        .status-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 4px 10px; borderRadius: 20px; font-size: 10px; font-weight: 800;
          border: 1px solid transparent; text-transform: uppercase; letter-spacing: 0.2px;
        }
        
        .row-attention { background: rgba(255, 77, 109, 0.015); }
        .row-attention:hover { background: rgba(255, 77, 109, 0.03) !important; }
        
        .drone-icon-circle {
          width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.05);
          display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.4);
          border: 1px solid rgba(255,255,255,0.05);
        }
        .drone-icon-circle.warn { background: rgba(255, 77, 109, 0.1); color: #ff4d6d; border-color: rgba(255,77,109,0.2); }

        .attention-label { font-size: 9px; color: #ff4d6d; font-weight: 800; margin-top: 4px; letter-spacing: 0.5px; }
        .attention-label-health { color: #ffd166; }

        .battery-v-group { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .battery-pct { font-size: 14px; font-weight: 800; }
        .battery-mini-bar {
          width: 64px; height: 5px; background: rgba(255,255,255,0.05);
          borderRadius: 3px; overflow: hidden; border: 1px solid rgba(255,255,255,0.03);
        }
        .battery-mini-bar .fill { height: 100%; transition: width 0.3s; }
        
        .icon-btn {
          width: 30px; height: 30px; borderRadius: 8px; border: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.5);
          display: flex; align-items: center; justifyContent: center; cursor: pointer; transition: all 0.2s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.12); color: #fff; border-color: rgba(255,255,255,0.15); }
        .icon-btn.danger:hover { background: #ff4d6d; color: #fff; border-color: #ff4d6d; }
        
        .status-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
        .status-option {
          padding: 10px; borderRadius: 8px; border: 1px solid rgba(255,255,255,0.1);
          background: rgba(0,0,0,0.2); cursor: pointer; textAlign: center; transition: all 0.2s;
        }
        .status-option.active { border-color: var(--primary); background: rgba(106, 228, 255, 0.05); }
        .status-option .icon { margin-bottom: 4px; display: flex; justify-content: center; }
        .status-option .label { font-size: 10px; font-weight: 700; }
        
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; z-index: 3000;
        }
        .modal-content {
          background: #0f172a; border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          width: 100%; max-width: 400px; padding: 40px;
        }
        .animate-pop { animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes modalPop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}

function StatBox({ label, value, subValue, icon, color, onClick, active, isCritical }) {
  return (
    <div className={`stat-card ${active ? 'active' : ''} ${isCritical ? 'critical' : ''}`} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ color: color || 'var(--primary)', opacity: 0.8 }}>{icon}</div>
        <div className="stat-value" style={color ? { color } : {}}>{value}</div>
      </div>
      <div className="stat-label" style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
      <div className="stat-sub">{subValue}</div>
    </div>
  );
}
