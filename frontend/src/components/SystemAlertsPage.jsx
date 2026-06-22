import React, { useState, useEffect, useCallback, useMemo } from "react";
import { alertsAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { Skeleton } from "./Skeleton";
import { formatBackendDateTime } from "../utils/datetime";
import { 
  AlertTriangle, CheckCircle2, Eye, 
  RefreshCw, ChevronDown, ChevronUp, BellOff,
  ShieldAlert, Activity, Info, Search, X, Check,
  Clock, Shield, AlertCircle
} from "lucide-react";

const SEVERITY_CONFIG = {
  info: { label: "INFO", color: "#6ae4ff", icon: <Info size={14} />, bg: "rgba(106, 228, 255, 0.1)" },
  warning: { label: "WARNING", color: "#ffd166", icon: <AlertTriangle size={14} />, bg: "rgba(255, 209, 102, 0.1)" },
  critical: { label: "CRITICAL", color: "#ff4d6d", icon: <ShieldAlert size={14} />, bg: "rgba(255, 77, 109, 0.1)" },
};

const STATUS_CONFIG = {
  new: { label: "NEW", color: "#ff4d6d", bg: "rgba(255, 77, 109, 0.12)", desc: "Requires initial acknowledgement" },
  acknowledged: { label: "ACKNOWLEDGED", color: "#ffd166", bg: "rgba(255, 209, 102, 0.12)", desc: "In progress / Waiting resolution" },
  resolved: { label: "RESOLVED", color: "#33d69f", bg: "rgba(51, 214, 159, 0.12)", desc: "Incident closed" },
};

export default function SystemAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  
    const [activeFilters, setActiveFilters] = useState({
    status: "all",
    severity: "all"
  });
  const [filters, setFilters] = useState({
    status: "all",
    severity: "all"
  });
  
  const [searchTerm, setSearchTerm] = useState("");
  const [groupSimilar, setGroupSimilar] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showDetail, setShowDetail] = useState(null);
  
  const [showConfirmAll, setShowConfirmAll] = useState(false);
  const [confirmResolveAlert, setConfirmResolveAlert] = useState(null);

  const toast = useToast();

  const [globalStats, setGlobalStats] = useState({
    active: 0,
    new: 0,
    critical: 0,
    warning: 0,
    resolved: 0
  });

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const [alertsRes, summaryRes] = await Promise.all([
        alertsAPI.list({ limit: 500 }),
        alertsAPI.summary()
      ]);
      setAlerts(alertsRes.data);
      if (summaryRes.data) {
        setGlobalStats({
          active: summaryRes.data.total_active || 0,
          new: summaryRes.data.total_new || 0,
          critical: summaryRes.data.critical || 0,
          warning: summaryRes.data.warning || 0,
          resolved: summaryRes.data.total_resolved || 0
        });
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to load alerts"));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleAcknowledge = async (alert) => {
    try {
      if (alert._isGroupHeader && alert._groupItems) {
        await Promise.all(alert._groupItems.map(a => alertsAPI.acknowledge(a.id)));
        toast.success(`Acknowledged ${alert._groupItems.length} similar alerts`);
      } else {
        await alertsAPI.acknowledge(alert.id);
        toast.success("Alert acknowledged");
      }
      fetchAlerts();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to acknowledge alert(s)"));
    }
  };

  const handleResolve = async (alert) => {
    try {
      if (alert._isGroupHeader && alert._groupItems) {
        await Promise.all(alert._groupItems.map(a => alertsAPI.resolve(a.id)));
        toast.success(`Resolved ${alert._groupItems.length} similar alerts`);
      } else {
        await alertsAPI.resolve(alert.id);
        toast.success("Alert marked as resolved");
      }
      setConfirmResolveAlert(null);
      if (showDetail?.id === alert.id) setShowDetail(null);
      fetchAlerts();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to resolve alert(s)"));
    }
  };

  const handleAcknowledgeAll = async () => {
    try {
      const res = await alertsAPI.acknowledgeAll();
      toast.success(`${res.data.acknowledged} new alerts acknowledged globally`);
      setShowConfirmAll(false);
      fetchAlerts();
    } catch (err) {
      toast.error("Failed to acknowledge all alerts");
    }
  };

  const handleApplyFilters = () => {
    setActiveFilters({ ...filters });
  };

  const handleResetFilters = () => {
    const reset = { status: "all", severity: "all" };
    setFilters(reset);
    setActiveFilters(reset);
    setSearchTerm("");
  };

    const processedAlerts = useMemo(() => {
    let result = [...alerts];

        if (activeFilters.status !== "all") {
      result = result.filter(a => a.status === activeFilters.status);
    }

        if (activeFilters.severity !== "all") {
      result = result.filter(a => a.severity === activeFilters.severity);
    }

        if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(a => 
        a.message.toLowerCase().includes(s) || 
        (a.details || "").toLowerCase().includes(s) ||
        (a.drone_id && a.drone_id.toString().includes(s))
      );
    }
    
        result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (groupSimilar) {
      const groupMap = new Map();
      const groupedOrder = [];

      result.forEach((alert) => {
                const baseMsg = alert.message.replace(/#\d+/g, '').replace(/\d+/g, '').trim().toLowerCase();
        const groupKey = `${baseMsg}-${alert.severity}-${alert.status}`;
        
        if (groupMap.has(groupKey)) {
          groupMap.get(groupKey).items.push(alert);
        } else {
          const newGroup = {
            id: `group-${alert.id}`,
            key: groupKey,
            main: alert,
            items: [alert]
          };
          groupMap.set(groupKey, newGroup);
          groupedOrder.push(newGroup);
        }
      });

      const final = [];
      groupedOrder.forEach(group => {
        if (group.items.length > 1) {
          const isExpanded = expandedGroups[group.id];
          
                    const uniqueDrones = new Set(group.items.map(i => i.drone_id).filter(id => id));
          const isMultiEntity = uniqueDrones.size > 1;

          final.push({ 
            ...group.main, 
            _isGroupHeader: true, 
            _groupCount: group.items.length, 
            _groupHiddenCount: group.items.length - 1,
            _groupId: group.id, 
            _isExpanded: isExpanded,
            _isMultiEntity: isMultiEntity,
            _uniqueEntitiesCount: uniqueDrones.size,
            _groupItems: group.items
          });
          if (isExpanded) {
            group.items.slice(1).forEach((item, idx) => {
              final.push({ ...item, _isGroupItem: true, _groupIndex: idx + 1 });
            });
          }
        } else {
          final.push(group.main);
        }
      });
      return final;
    }

    return result;
  }, [alerts, activeFilters, searchTerm, groupSimilar, expandedGroups]);

  const toggleGroup = (id) => {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const [healthStatus, setHealthStatus] = useState({
    api: 'online',
    db: 'online',
    ws: 'online',
    weather: 'warning',
    simulator: 'running',
    lastCheck: new Date()
  });

  return (
    <div className="stack theme-admin" style={{ padding: '0 24px 60px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(255, 77, 109, 0.1)', color: '#ff4d6d', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255, 77, 109, 0.2)' }}>
            <ShieldAlert size={24} />
          </div>
          <div>
            <h1 style={{ margin: 0 }}>System Health & Alerts</h1>
            <p className="subtle" style={{ margin: 0, marginTop: 4 }}>Monitor and manage mission-critical system incidents.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowConfirmAll(true)} disabled={globalStats.new === 0} style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Acknowledge all new alerts across the entire system">
            <CheckCircle2 size={14} /> Ack New ({globalStats.new})
          </button>
          <button className="btn btn-primary btn-sm" onClick={fetchAlerts} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </header>

            <div className="health-bar-premium">
        <div className="health-title">
          <Activity size={16} /> Core Infrastructure
        </div>
        <div className="health-metrics">
          <HealthNode label="Core API" status={healthStatus.api} />
          <HealthNode label="Database" status={healthStatus.db} />
          <HealthNode label="WebSocket" status={healthStatus.ws} />
          <HealthNode label="Weather Sync" status={healthStatus.weather} />
          <HealthNode label="Simulator" status={healthStatus.simulator} />
        </div>
        <div className="health-last-check">
          Last check: {healthStatus.lastCheck.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
      </div>

            <div className="grid grid-4 kpi-row" style={{ gap: 16, marginBottom: 24 }}>
        <SummaryCard label="Unresolved Incidents" value={globalStats.active} icon={<Activity size={20} />} color="#6ae4ff" onClick={() => { const f = { ...filters, status: 'all' }; setFilters(f); setActiveFilters(f); }} />
        <SummaryCard label="Critical Alerts" value={globalStats.critical} icon={<AlertCircle size={20} />} color="#ff4d6d" onClick={() => { const f = { ...filters, severity: 'critical', status: 'all' }; setFilters(f); setActiveFilters(f); }} />
        <SummaryCard label="Warnings" value={globalStats.warning} icon={<AlertTriangle size={20} />} color="#ffd166" onClick={() => { const f = { ...filters, severity: 'warning', status: 'all' }; setFilters(f); setActiveFilters(f); }} />
        <SummaryCard label="Resolved" value={globalStats.resolved} icon={<CheckCircle2 size={20} />} color="#33d69f" onClick={() => { const f = { ...filters, status: 'resolved' }; setFilters(f); setActiveFilters(f); }} />
      </div>

            <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body stack" style={{ gap: 14, padding: '14px 20px' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ flex: 1, position: "relative" }}>
               <Search size={16} className="subtle" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
               <input 
                type="text" 
                placeholder="Search by drone ID or description..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="audit-input-premium"
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
               <button className="btn btn-primary" onClick={handleApplyFilters} style={{ padding: '0 24px', height: 38, fontSize: 13 }}>Filter</button>
               <button className="btn btn-ghost" onClick={handleResetFilters} title="Reset all" style={{ width: 38, padding: 0 }}><RefreshCw size={16} /></button>
            </div>
          </div>

          <div className="filter-controls-row">
            <div className="dropdown-cluster">
              <select className="audit-select-compact" value={filters.status} onChange={(e) => setFilters({...filters, status: e.target.value})}>
                <option value="all">Any Status</option>
                <option value="new">New (Unacknowledged)</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
              </select>
              <select className="audit-select-compact" value={filters.severity} onChange={(e) => setFilters({...filters, severity: e.target.value})}>
                <option value="all">Any Severity</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
            
            <div className="divider-v" />
            
            <label className="toggle-label">
              <input type="checkbox" checked={groupSimilar} onChange={e => setGroupSimilar(e.target.checked)} />
              GROUP REPETITIVE
            </label>
          </div>
        </div>
      </div>

            <div className="card table-card-premium">
        {loading ? (
          <div style={{ padding: 40 }}>
            <div className="stack" style={{ gap: 16 }}>
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={40} style={{ borderRadius: 8 }} />)}
            </div>
          </div>
        ) : processedAlerts.length === 0 ? (
          <div style={{ padding: '80px 20px', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', padding: 24, borderRadius: '50%', background: 'rgba(51, 214, 159, 0.1)', color: '#33d69f', marginBottom: 20 }}>
              <CheckCircle2 size={40} />
            </div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 18 }}>System Fully Healthy</h3>
            <p className="subtle" style={{ margin: 0, fontSize: 14 }}>No incidents match your current filters.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="audit-data-table-dense">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Timestamp</th>
                  <th style={{ width: 60 }}>Sev</th>
                  <th style={{ width: 400 }}>Incident Details</th>
                  <th style={{ width: 120 }}>Drone / Entity</th>
                  <th style={{ width: 140 }}>Status</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {processedAlerts.map((alert, i) => {
                  const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
                  const status = STATUS_CONFIG[alert.status];
                  const isGroupHeader = alert._isGroupHeader;
                  const isGroupItem = alert._isGroupItem;

                  return (
                    <tr key={`${alert.id}-${i}`} className={`${isGroupHeader ? 'row-group-header' : ''} ${isGroupItem ? 'row-group-item' : ''}`}>
                      <td>
                        <div className="timestamp-stack-compact">
                          <span className="date">{fmtDateCompact(alert.created_at)}</span>
                          <span className="time">{fmtTimeCompact(alert.created_at)}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ color: config.color, display: 'flex', justifyContent: 'center' }} title={config.label}>
                          {config.icon}
                        </div>
                      </td>
                      <td>
                        <div className="op-cluster-compact">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{formatAlertTitle(alert.message)}</span>
                            {isGroupHeader && (
                              <span className="group-count-badge">{alert._groupCount} events ({alert._groupHiddenCount} more)</span>
                            )}
                          </div>
                          <p className="op-description-text">{formatAlertDesc(alert.details)}</p>
                        </div>
                      </td>
                      <td>
                        {alert._isMultiEntity ? (
                          <div className="entity-ref-badge-premium" style={{ background: 'rgba(255,209,102,0.1)', color: '#ffd166' }}>
                            <Activity size={10} className="link-icon" />
                            <span>{alert._uniqueEntitiesCount} Entities Affected</span>
                          </div>
                        ) : alert.drone_id ? (
                          <div className="entity-ref-badge-premium">
                            <Activity size={10} className="link-icon" style={{ color: 'var(--primary)' }} />
                            <span>{formatDroneName(alert.drone_id)}</span>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className="subtle" style={{ lineHeight: 1 }}>System Core</span>
                            {alert.message.includes('(drone ') && (
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', lineHeight: 1 }}>
                                Affected: {alert.message.match(/\(drone (.*?)\s*cannot continue\)/)?.[1] || alert.message.match(/\(drone (.*?)\)/)?.[1]}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className={`status-badge-inline ${alert.status}`} style={{ color: status.color, background: status.bg }}>
                          {status.label}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {isGroupHeader && (
                            <button
                              className="btn-table-action"
                              onClick={() => toggleGroup(alert._groupId)}
                              title={alert._isExpanded ? "Collapse" : "Expand"}
                            >
                              {alert._isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          )}
                          <button className="btn-table-inspect" onClick={() => setShowDetail(alert)}>
                            <Eye size={13} />
                            <span>Inspect</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            
            <div className="audit-table-footer-premium">
              <div className="records-count">
                <span className="dot-live" />
                SHOWING LATEST {alerts.length} OF {globalStats.active + globalStats.resolved} INCIDENTS
                {alerts.length !== processedAlerts.length && (
                  <span style={{ textTransform: 'lowercase', opacity: 0.6, fontWeight: 600, marginLeft: 4 }}>
                    (grouped into {processedAlerts.length} rows)
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

            <div className={`audit-drawer-overlay ${showDetail ? 'visible' : ''}`} onClick={() => setShowDetail(null)}>
        <div className={`audit-drawer ${showDetail ? 'open' : ''}`} onClick={e => e.stopPropagation()}>
          {showDetail && (
            <>
              <div className="drawer-header-compact-fixed">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="drawer-type-icon" style={{ 
                    background: (SEVERITY_CONFIG[showDetail.severity] || SEVERITY_CONFIG.info).bg,
                    color: (SEVERITY_CONFIG[showDetail.severity] || SEVERITY_CONFIG.info).color
                  }}>
                    {(SEVERITY_CONFIG[showDetail.severity] || SEVERITY_CONFIG.info).icon}
                  </div>
                  <div>
                    <h2 className="drawer-title-final">{formatAlertTitle(showDetail.message)}</h2>
                    <div className="drawer-meta-final">
                      <span className="cat" style={{ color: (SEVERITY_CONFIG[showDetail.severity] || SEVERITY_CONFIG.info).color }}>
                        {showDetail.severity.toUpperCase()}
                      </span>
                      <span className="dot">•</span>
                      <span className="ts">{fmtFriendlyFull(showDetail.created_at)}</span>
                    </div>
                  </div>
                </div>
                <button className="btn-close-final" onClick={() => setShowDetail(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="drawer-body-compact-scroll">
                <div className="drawer-section-final">
                  <h4 className="section-heading-final">INCIDENT STATUS</h4>
                  <div className="detail-grid-final">
                    <DetailBox 
                      label="Status" 
                      value={STATUS_CONFIG[showDetail.status]?.label || showDetail.status} 
                      subtext={STATUS_CONFIG[showDetail.status]?.desc}
                    />
                    <DetailBox label="Entity Ref" value={showDetail.drone_id ? formatDroneName(showDetail.drone_id) : 'System Core'} />
                  </div>
                </div>

                <div className="drawer-section-final">
                  <h4 className="section-heading-final">DIAGNOSTIC DETAILS</h4>
                  <div className="description-card-final">
                    <Info size={14} className="info-icon" />
                    <p>{formatAlertDesc(showDetail.details)}</p>
                  </div>
                </div>
                
                {showDetail.status !== "resolved" && (
                  <div className="drawer-section-final" style={{ marginTop: 'auto' }}>
                    <h4 className="section-heading-final">RESOLUTION ACTIONS</h4>
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                       {showDetail.status === "new" && (
                          <button 
                            className="btn-action-primary flex-1" 
                            style={{ background: '#ffd166', color: '#000' }} 
                            onClick={() => { handleAcknowledge(showDetail); setShowDetail(null); }}
                            title="Acknowledge: Admin has seen the alert, but the issue still exists."
                          >
                            <Eye size={16} /> Acknowledge Alert
                          </button>
                       )}
                       {!(showDetail.severity === 'critical' && showDetail.status === 'new') && (
                         <button 
                           className="btn-action-primary flex-1" 
                           style={{ background: '#33d69f', color: '#000' }} 
                           onClick={() => {
                             if (showDetail.severity === 'critical') {
                               setConfirmResolveAlert(showDetail);
                             } else {
                               handleResolve(showDetail);
                             }
                           }}
                           title="Resolve: The underlying issue has been fixed and the alert can be closed."
                         >
                           <CheckCircle2 size={16} /> Mark as Resolved
                         </button>
                       )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

            {showConfirmAll && (
        <div className="audit-drawer-overlay visible" onClick={() => setShowConfirmAll(false)}>
          <div className="modal-content animate-pop" style={{ maxWidth: 420, margin: '20vh auto', background: '#0f172a', padding: 32, borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(106,228,255,0.1)', color: '#6ae4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid rgba(106,228,255,0.2)' }}>
              <CheckCircle2 size={32} />
            </div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 22, color: '#fff' }}>Acknowledge {globalStats.new} new alerts?</h3>
            <p style={{ margin: '0 0 32px 0', fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
              This will mark all new incidents as acknowledged.
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              <button className="btn" style={{ flex: 1, padding: 14, borderRadius: 12 }} onClick={() => setShowConfirmAll(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, padding: 14, borderRadius: 12, background: '#6ae4ff', color: '#000' }} onClick={handleAcknowledgeAll}>Confirm Action</button>
            </div>
          </div>
        </div>
      )}

      {confirmResolveAlert && (
        <div className="audit-drawer-overlay visible" onClick={() => setConfirmResolveAlert(null)}>
          <div className="modal-content animate-pop" style={{ maxWidth: 420, margin: '20vh auto', background: '#0f172a', padding: 32, borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(51, 214, 159, 0.1)', color: '#33d69f', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid rgba(51, 214, 159, 0.2)' }}>
              <ShieldAlert size={32} />
            </div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 22, color: '#fff' }}>Resolve Incident?</h3>
            <p style={{ margin: '0 0 32px 0', fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
              You are about to mark this {confirmResolveAlert.severity} incident as <strong>Resolved</strong>. Please ensure the underlying issue has been physically or operationally fixed.
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              <button className="btn" style={{ flex: 1, padding: 14, borderRadius: 12 }} onClick={() => setConfirmResolveAlert(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, padding: 14, borderRadius: 12, background: '#33d69f', color: '#000' }} onClick={() => handleResolve(confirmResolveAlert)}>Resolve Incident</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* Health Bar */
        .health-bar-premium {
          display: flex; align-items: center; justify-content: space-between;
          background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.05);
          border-radius: 14px; padding: 12px 24px; margin-bottom: 24px; backdrop-filter: blur(12px);
          box-shadow: 0 4px 20px rgba(0,0,0,0.1); gap: 24px;
        }
        .health-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 0.05em; }
        .health-metrics { display: flex; align-items: center; gap: 24px; flex: 1; flex-wrap: wrap; }
        .health-node { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.6); }
        .health-node .dot { width: 8px; height: 8px; border-radius: 50%; }
        .health-node .dot.online { background: #33d69f; box-shadow: 0 0 10px rgba(51,214,159,0.5); }
        .health-node .dot.warning { background: #ffd166; box-shadow: 0 0 10px rgba(255,209,102,0.5); }
        .health-node .dot.error { background: #ff4d6d; box-shadow: 0 0 10px rgba(255,77,109,0.5); }
        .health-node .dot.running { background: #6ae4ff; box-shadow: 0 0 10px rgba(106,228,255,0.5); animation: pulseLive 2s infinite; }
        .health-last-check { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.3); font-family: 'JetBrains Mono', monospace; }

        /* Core Aesthetics */
        .summary-card-interactive { 
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04);
          border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 16px;
          cursor: pointer; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .summary-card-interactive:hover { 
          background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); 
          transform: translateY(-2px); box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .summary-icon-box { 
          width: 48px; height: 48px; border-radius: 12px; 
          display: flex; align-items: center; justify-content: center;
        }

        .audit-input-premium { 
          width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); 
          border-radius: 8px; padding: 10px 14px 10px 38px; color: #fff; font-size: 13px; font-weight: 500; transition: 0.2s;
        }
        .audit-input-premium:focus { border-color: var(--primary); outline: none; background: rgba(0,0,0,0.4); box-shadow: 0 0 0 3px rgba(106, 228, 255, 0.1); }
        
        .audit-select-compact {
          background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px; padding: 8px 30px 8px 12px; color: rgba(255,255,255,0.8);
          font-size: 12px; font-weight: 600; cursor: pointer; appearance: none;
          background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23FFFFFF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
          background-repeat: no-repeat; background-position: right 10px top 50%; background-size: 8px auto; transition: 0.2s;
        }
        .audit-select-compact:hover { border-color: rgba(255,255,255,0.2); color: #fff; }
        .audit-select-compact:focus { outline: none; border-color: var(--primary); }
        .audit-select-compact option { background: #1e293b; color: #fff; }

        .filter-controls-row { display: flex; align-items: center; gap: 16px; background: rgba(0,0,0,0.15); padding: 8px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.03); }
        .dropdown-cluster { display: flex; gap: 10px; }
        .divider-v { width: 1px; height: 16px; background: rgba(255,255,255,0.1); margin: 0 4px; }
        
        .toggle-label { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); cursor: pointer; }
        .toggle-label input { cursor: pointer; }

        /* Table Aesthetics */
        .table-card-premium { background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; overflow: hidden; backdrop-filter: blur(12px); box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        .audit-data-table-dense { width: 100%; border-collapse: separate; border-spacing: 0; }
        .audit-data-table-dense thead th { 
          padding: 12px 20px; text-align: left; font-size: 10.5px; font-weight: 800; color: rgba(255,255,255,0.4);
          text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .audit-data-table-dense tbody td { padding: 10px 20px; vertical-align: middle; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .audit-data-table-dense tbody tr:hover { background: rgba(255,255,255,0.02); }
        
        .row-group-header { background: rgba(106, 228, 255, 0.02); }
        .row-group-item { background: rgba(255,255,255,0.01); border-left: 2px solid rgba(106, 228, 255, 0.2); }
        
        .timestamp-stack-compact { display: flex; flex-direction: column; }
        .timestamp-stack-compact .date { font-size: 12px; font-weight: 700; color: #fff; }
        .timestamp-stack-compact .time { font-size: 10.5px; color: rgba(255,255,255,0.3); font-weight: 600; }

        .op-cluster-compact { display: flex; flex-direction: column; gap: 2px; }
        .group-count-badge { background: rgba(0,0,0,0.3); color: #fff; padding: 1px 6px; border-radius: 4px; font-size: 9.5px; }
        .op-description-text { margin: 0; font-size: 11.5px; color: rgba(255,255,255,0.4); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

        .entity-ref-badge-premium { 
          display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px;
          font-size: 10px; font-weight: 800; cursor: pointer; transition: 0.2s; background: rgba(106,228,255,0.05); color: #fff;
        }
        
        .status-badge-inline {
          display: inline-flex; align-items: center; justify-content: center;
          padding: 4px 8px; border-radius: 6px; font-size: 9.5px; font-weight: 900;
          letter-spacing: 0.05em; border: 1px solid rgba(255,255,255,0.05);
        }
        .status-badge-inline.new { animation: alertPulse 2s infinite; }
        @keyframes alertPulse { 0% { box-shadow: 0 0 0 0 rgba(255,77,109,0.4); } 70% { box-shadow: 0 0 0 6px rgba(255,77,109,0); } 100% { box-shadow: 0 0 0 0 rgba(255,77,109,0); } }

        .btn-table-inspect { 
          display: flex; align-items: center; gap: 6px; background: rgba(106, 228, 255, 0.08); border: 1px solid rgba(106, 228, 255, 0.15);
          border-radius: 6px; padding: 4px 10px; color: var(--primary); font-size: 11.5px; font-weight: 700; cursor: pointer; transition: 0.2s;
        }
        .btn-table-inspect:hover { background: var(--primary); color: #000; }
        .btn-table-action { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer; }
        
        .audit-table-footer-premium { 
          padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; 
          background: rgba(0,0,0,0.1); border-top: 1px solid rgba(255,255,255,0.05);
        }
        .records-count { font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; display: flex; align-items: center; gap: 8px; }
        .dot-live { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 10px var(--primary); animation: pulseLive 2s infinite; }
        @keyframes pulseLive { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }

        /* Drawer */
        .audit-drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.25); backdrop-filter: blur(8px); z-index: 5000; visibility: hidden; opacity: 0; transition: 0.3s; }
        .audit-drawer-overlay.visible { visibility: visible; opacity: 1; }
        .audit-drawer { position: fixed; top: 0; right: -520px; bottom: 0; width: 520px; background: #0f172a; box-shadow: -15px 0 50px rgba(0,0,0,0.5); z-index: 5001; transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; }
        .audit-drawer.open { right: 0; }
        
        .drawer-header-compact-fixed { padding: 18px 24px; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; }
        .drawer-type-icon { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        .drawer-title-final { margin: 0; font-size: 15px; font-weight: 900; color: #fff; letter-spacing: 0.02em; }
        .drawer-meta-final { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
        .cat { font-size: 9.5px; font-weight: 900; text-transform: uppercase; }
        .ts { font-size: 11.5px; color: rgba(255,255,255,0.3); }
        .btn-close-final { width: 26px; height: 26px; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        
        .drawer-body-compact-scroll { flex: 1; padding: 22px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 24px; }
        .drawer-section-final { display: flex; flex-direction: column; gap: 10px; }
        .section-heading-final { margin: 0; font-size: 10px; font-weight: 900; text-transform: uppercase; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; }
        
        .detail-grid-final { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .detail-box-final { padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; display: flex; flex-direction: column; gap: 4px; }
        .detail-box-final .label { font-size: 8.5px; font-weight: 900; color: rgba(255,255,255,0.2); text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
        .detail-box-final .value { font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,0.8); }
        .mono-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--primary); }
        
        .description-card-final { padding: 12px 16px; background: rgba(255,255,255,0.02); border-left: 2px solid var(--primary); border-radius: 4px 10px 10px 4px; display: flex; gap: 12px; }
        .description-card-final p { margin: 0; font-size: 12.5px; font-weight: 600; color: #fff; line-height: 1.4; }
        .info-icon { color: var(--primary); opacity: 0.5; margin-top: 1px; }

        .btn-action-primary { border: none; padding: 12px; font-size: 13px; font-weight: 800; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s; }
        .btn-action-primary:hover { filter: brightness(1.1); transform: translateY(-2px); }
        .flex-1 { flex: 1; }
      `}</style>
    </div>
  );
}

function HealthNode({ label, status }) {
  return (
    <div className="health-node" title={`${label} Status: ${status.toUpperCase()}`} style={{ cursor: 'help' }}>
      <div className={`dot ${status}`} />
      <span>
        {label}
        {status !== 'online' && status !== 'running' && (
          <span style={{ marginLeft: 6, fontSize: '9px', opacity: 0.8, color: status === 'warning' ? '#ffd166' : '#ff4d6d', fontWeight: 800 }}>
            [{status.toUpperCase()}]
          </span>
        )}
      </span>
    </div>
  );
}

function SummaryCard({ label, value, icon, color, onClick }) {
  return (
    <div className="summary-card-interactive" onClick={onClick}>
      <div className="summary-icon-box" style={{ background: `${color}12`, color }}>{icon}</div>
      <div>
        <div className="subtle" style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>{value}</div>
      </div>
    </div>
  );
}

function DetailBox({ label, value, icon, isMono, subtext }) {
  return (
    <div className="detail-box-final">
      <div className="label">{icon} {label}</div>
      <div className={`value ${isMono ? 'mono-val' : ''}`}>{value}</div>
      {subtext && <div style={{ fontSize: '9px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginTop: 2, lineHeight: 1.3 }}>{subtext}</div>}
    </div>
  );
}

function fmtDateCompact(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "N/A";
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtTimeCompact(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "N/A";
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function fmtFriendlyFull(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "N/A";
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDroneName(id) {
  if (!id) return "Unknown";
  const greek = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon"];
  return `AF-${String(id).padStart(2, '0')} ${greek[(id - 1) % greek.length]}`;
}

function formatAlertTitle(msg) {
  if (!msg) return "Unknown Alert";
  let m = msg.replace(/are baterie scazuta/gi, "Low battery threshold")
             .replace(/eroare conexiune/gi, "Network connection failure")
             .replace(/senzor defect/gi, "Sensor malfunction detected");

  if (m.includes('(drone ')) {
    const parts = m.split('(drone ');
    return (
      <span style={{ display: 'block', lineHeight: 1.3 }}>
        <span>{parts[0].trim()}</span>
        <br/>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>(drone {parts[1]}</span>
      </span>
    );
  }
  
  if (m.includes('of drone ')) {
    const parts = m.split('of drone ');
    return (
      <span style={{ display: 'block', lineHeight: 1.3 }}>
        <span>{parts[0].trim()}</span>
        <br/>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>of drone {parts[1]}</span>
      </span>
    );
  }

  return <span style={{ display: 'block', lineHeight: 1.3 }}>{m}</span>;
}

function formatAlertDesc(desc) {
  if (!desc) return "No additional diagnostic data provided.";
  return desc.replace(/baterie scăzută/gi, "low battery level")
             .replace(/vânt puternic/gi, "strong wind conditions")
             .replace(/obstacol/gi, "obstacle detected on path");
}
