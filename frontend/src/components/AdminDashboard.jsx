import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { 
  Users, Package, Plane, AlertTriangle, 
  Activity, ArrowUpRight, Clock, RefreshCw,
  ShieldCheck, AlertCircle, List
} from "lucide-react";
import { 
  usersAPI, dronesAPI, deliveriesAPI, alertsAPI, auditAPI, systemAPI,
  getErrorMessage 
} from "../services/api";
import { useToast } from "../hooks/useToast";
import { SuccessRateChart, FailureReasonsChart } from "./charts/DashboardCharts";
import { parseBackendDateTime } from "../utils/datetime";

import { useWebSocketMonitor } from "../hooks/useWebSocketMonitor";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [drones, setDrones] = useState([]);
  const [users, setUsers] = useState([]);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [alertSummary, setAlertSummary] = useState(null);
  const [recentActions, setRecentActions] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(new Date());
  const toast = useToast();

  const fetchData = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      const [
        analyticsRes, dronesRes, usersRes, alertsRes, alertsSummaryRes, auditRes, healthRes
      ] = await Promise.all([
        deliveriesAPI.getAnalytics(),
        dronesAPI.list(),
        usersAPI.list(),
        alertsAPI.list({ status: "new", limit: 20 }),
        alertsAPI.summary(),
        auditAPI.getRecent(15),
        systemAPI.getHealth()
      ]);

      setStats(analyticsRes.data);
      setDrones(dronesRes.data);
      setUsers(usersRes.data);
      setRecentAlerts(alertsRes.data || []);
      setAlertSummary(alertsSummaryRes.data || null);
      setRecentActions(auditRes.data || []);
      setSystemHealth(healthRes.data);
      setLastSync(new Date());
    } catch (err) {
      if (!isSilent) toast.error(getErrorMessage(err, "Failed to load admin dashboard data"));
    } finally {
      setLoading(false);
    }
  }, [toast]);

      const { isConnected: wsConnected } = useWebSocketMonitor(null);

  useEffect(() => {
    fetchData();
        const interval = setInterval(() => {
      fetchData(true);
    }, wsConnected ? 60000 : 20000);
    return () => clearInterval(interval);
  }, [fetchData, wsConnected]);

  const droneStats = {
    total: drones.length,
    maintenance: drones.filter(d => d.status === "maintenance").length,
    inactive: drones.filter(d => d.status === "inactive").length,
    critical: drones.filter(d => d.battery < 15 && d.status !== "charging").length,
  };

  const activeUsersToday = users.filter(u => {
    if (!u.last_login) return false;
    const lastLogin = parseBackendDateTime(u.last_login);
    if (!lastLogin) return false;
    const today = new Date();
    return lastLogin.toDateString() === today.toDateString();
  }).length;

  const totalNewAlerts = alertSummary?.total_new ?? recentAlerts.length;

  const extractRecipientFromDescription = (description) => {
    if (!description || typeof description !== "string") return null;
    const match = description.match(/confirmed by\s+(.+)$/i);
    if (!match) return null;
    const recipient = match[1].trim();
    return recipient || null;
  };

  const resolveActivityActor = (log) => {
    if (log?.user_email) {
      return {
        label: log.user_email,
        initial: log.user_email.charAt(0).toUpperCase() || "U",
        tone: log.user_role === "admin" ? "admin" : "user",
      };
    }

    const recipientName = extractRecipientFromDescription(log?.description);
    if (log?.action === "DELIVERY_CONFIRMED" && recipientName) {
      return {
        label: `Recipient: ${recipientName}`,
        initial: recipientName.charAt(0).toUpperCase() || "R",
        tone: "user",
      };
    }

    return {
      label: "System Automation",
      initial: "S",
      tone: "system",
    };
  };

    const chartData = (stats?.deliveries_time_series || []).map((point) => ({
    date: point.day_label || point.date,
    success: point.completed || 0,
    failed: point.failed || 0,
  }));
  const throughputWindowDays = chartData.length;

  const failureLabelMap = {
    battery: "Battery",
    weather: "Weather",
    route_blocked: "Route Blocked",
    reassignment: "Reassignment",
    aborted_by_dispatcher: "Aborted by Dispatcher",
    other: "Other",
    unknown: "Unknown",
  };

  const failedByCause = stats?.failed_by_cause || {};
  const totalFailedCount = Object.values(failedByCause).reduce((sum, count) => sum + (count || 0), 0);

  const failureReasons = Object.entries(failedByCause)
    .map(([key, count]) => ({
      name: failureLabelMap[key] || key,
      value: totalFailedCount > 0 ? Math.round((count / totalFailedCount) * 100) : 0,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="stack theme-admin">
      <header className="page-header">
        <div style={{ marginLeft: -24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <ShieldCheck size={32} color="var(--primary)" style={{ flexShrink: 0, marginTop: 4 }} />
            <div>
              <h1 style={{ margin: 0 }}>Admin Console</h1>
              <p className="subtle" style={{ margin: 0, marginTop: 4 }}>Platform oversight and system governance.</p>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="subtle" style={{ fontSize: 12, textAlign: "right" }}>
            <div>Last Sync: {lastSync.toLocaleTimeString()}</div>
            <div style={{ color: "var(--primary)", display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
              <span className="pulse-dot" /> System Online
            </div>
          </div>
          <button className="btn" onClick={fetchData} disabled={loading} title="Refresh Data">
            <RefreshCw size={16} className={loading ? "spin" : ""} />
          </button>
          <Link to="/settings" className="btn btn-primary">Configuration</Link>
        </div>
      </header>

            <div className="status-strip">
        {systemHealth ? (
          <>
            <div className="status-item" title={systemHealth.components.system.message}>
              <span className={`status-dot ${systemHealth.components.system.status === 'online' ? 'online' : 'error'}`} /> 
              System
            </div>
            <div className="status-item" title={systemHealth.components.websocket.message}>
              <span className={`status-dot ${systemHealth.components.websocket.status === 'online' ? 'online' : 'warning'}`} /> 
              WebSocket
            </div>
            <div className="status-item" title={systemHealth.components.weather.message}>
              <span className={`status-dot ${systemHealth.components.weather.status === 'online' ? 'online' : 'warning'}`} /> 
              Weather Sync
            </div>
            <div className="status-item" title={systemHealth.components.simulator.message}>
              <span className={`status-dot ${systemHealth.components.simulator.status === 'online' ? 'online' : 'error'}`} /> 
              Simulator
            </div>
            <div className="status-item subtle" style={{ marginLeft: 'auto', fontSize: 10 }}>
              Last health check: {new Date(systemHealth.timestamp * 1000).toLocaleTimeString()}
            </div>
          </>
        ) : (
          <div className="status-item subtle">Fetching system health...</div>
        )}
      </div>

            <div className="grid grid-4" style={{ marginTop: 24 }}>
        <StatCard 
          label="Active Users Today" 
          value={activeUsersToday} 
          subValue={`${activeUsersToday} active today / ${users.length} total`}
          icon={<Users size={20} />} 
          link="/users"
          color="#6ae4ff"
        />
        <StatCard 
          label="Drone Fleet" 
          value={droneStats.total} 
          subValue={`${droneStats.total} total / ${droneStats.maintenance} maintenance`}
          icon={<DroneIcon size={20} />} 
          link="/drones"
          color="#33d69f"
        />
        <StatCard 
          label="Completed Today" 
          value={stats?.completed_today || 0} 
          subValue={`${stats?.completed_today || 0} completed / ${stats?.failed_today || 0} failed today`}
          icon={<Package size={20} />} 
          link="/analytics"
          color="#ffd166"
        />
        <StatCard 
          label="Alerts Active" 
          value={totalNewAlerts} 
          subValue={`${totalNewAlerts} unresolved`}
          icon={<AlertTriangle size={20} />} 
          link="/alerts"
          color={totalNewAlerts > 0 ? "#ff4d6d" : "#33d69f"}
          statusText={totalNewAlerts > 0 ? "Attention Required" : "System Stable"}
          trend={totalNewAlerts > 0 ? "up" : "down"}
        />
      </div>

      <div className="grid grid-3" style={{ marginTop: 24, alignItems: "stretch" }}>
                <div className="span-2">
          <SuccessRateChart
            data={chartData}
            timeWindowLabel={throughputWindowDays > 0 ? `Last ${throughputWindowDays} days` : "No recent days"}
          />
        </div>

                <div>
          <FailureReasonsChart 
            data={failureReasons}
          />
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 24, alignItems: "stretch" }}>
                <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertCircle size={16} color="#ff4d6d" /> 
              System Issues
              <span className="badge" style={{ fontSize: 10, background: 'rgba(255,77,109,0.1)', color: '#ff4d6d', border: 'none', fontWeight: 700 }}>
                {totalNewAlerts} total · latest 4
              </span>
            </h3>
            <Link to="/alerts" className="text-link" style={{ fontSize: 11, fontWeight: 700 }}>View All</Link>
          </div>
          <div className="card-body" style={{ padding: "0 12px 12px 12px" }}>
            {recentAlerts.length > 0 ? (
              <div className="issue-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Array.from(
                  recentAlerts.reduce((map, alert) => {
                    const dedupeKey = alert.drone_id ?? `alert-${alert.id}`;
                                        const currentCreatedAt = parseBackendDateTime(alert.created_at);
                    const existingCreatedAt = parseBackendDateTime(map.get(dedupeKey)?.created_at);
                    if (!map.has(dedupeKey) || !existingCreatedAt || (currentCreatedAt && currentCreatedAt > existingCreatedAt)) {
                      map.set(dedupeKey, alert);
                    }
                    return map;
                  }, new Map()).values()
                )
                  .sort((a, b) => {
                    const bTs = parseBackendDateTime(b.created_at)?.getTime() ?? 0;
                    const aTs = parseBackendDateTime(a.created_at)?.getTime() ?? 0;
                    return bTs - aTs;
                  })
                  .slice(0, 4)
                  .map(alert => {
                    const rawMessage = typeof alert.message === "string" ? alert.message.trim() : "";
                    const isCritical = alert.severity === 'critical' || rawMessage.toLowerCase().includes('critical');
                    
                                        let batteryVal = alert.battery; 
                    if (!batteryVal && alert.details) {
                      try {
                        const parsed = JSON.parse(alert.details);
                        batteryVal = parsed.battery || parsed.battery_level || parsed.level;
                        if (!batteryVal && typeof parsed.percentage === "number") {
                          batteryVal = parsed.percentage;
                        }
                      } catch {
                        const match = rawMessage.match(/(\d+(\.\d+)?)%/);
                        if (match) batteryVal = match[1];
                      }
                    }
                    if (!batteryVal) {
                       const match = rawMessage.match(/(\d+(\.\d+)?)%/);
                       if (match) batteryVal = match[1];
                    }

                    let detailReason = "";
                    if (batteryVal) {
                      detailReason = "Low battery";
                    } else if (alert.details) {
                      try {
                        const parsed = JSON.parse(alert.details);
                        detailReason = (
                          parsed.reason ||
                          parsed.message ||
                          parsed.error ||
                          parsed.diagnostic_reason ||
                          parsed.diagnostic ||
                          ""
                        );
                      } catch {
                        detailReason = "";
                      }
                    }

                    if (!detailReason && rawMessage) {
                      detailReason = rawMessage;
                    }
                    if (!detailReason) {
                      detailReason = "No diagnostic details provided";
                    }

                    const hasAssignedDrone = Boolean(alert.drone_id || alert.drone_name);
                    const issueSource = hasAssignedDrone
                      ? (alert.drone_name || formatDroneName(alert.drone_id))
                      : "Unassigned system issue";
                    const title = hasAssignedDrone
                      ? `${issueSource} reported issue`
                      : issueSource;
                    const metaSource = hasAssignedDrone
                      ? (alert.drone_name || formatDroneName(alert.drone_id))
                      : "Unassigned";

                    return (
                      <Link key={alert.id} to="/alerts" className="issue-row" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                        <div className={`severity-bar ${isCritical ? 'critical' : 'warning'}`} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ fontSize: 11, fontWeight: 900, color: isCritical ? '#ff4d6d' : '#ffd166', letterSpacing: '0.8px' }}>
                              {isCritical ? 'CRITICAL' : 'WARNING'}
                            </div>
                            <ArrowUpRight size={14} style={{ opacity: 0.2 }} />
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 1, color: 'rgba(255,255,255,0.95)' }}>
                            {title}: 
                            <span style={{ color: isCritical ? '#ff4d6d' : '#ffd166', marginLeft: 4 }}>
                              {batteryVal ? `${detailReason} (${batteryVal}%)` : detailReason}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600 }}>{metaSource}</span>
                            <span>•</span>
                            <span>{fmtTimeAgo(alert.created_at)}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <ShieldCheck size={32} style={{ opacity: 0.1, marginBottom: 8 }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>All Systems Nominal</div>
              </div>
            )}
          </div>
        </div>

                <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px" }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
              <List size={16} /> 
              Activity Feed
            </h3>
            <Link to="/audit" className="text-link" style={{ fontSize: 11, fontWeight: 700 }}>Audit Log</Link>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {recentActions.length > 0 ? (
              <div className="activity-feed">
                {recentActions
                  .filter((log, index, self) => {
                                        if (index === 0) return true;
                    const prev = self[index - 1];
                    if (!(log.action === "USER_LOGIN" && prev.action === "USER_LOGIN")) return true;
                    if (!log.user_email || !prev.user_email || log.user_email !== prev.user_email) return true;

                    const currentTs = parseBackendDateTime(log.created_at)?.getTime();
                    const prevTs = parseBackendDateTime(prev.created_at)?.getTime();
                    if (currentTs == null || prevTs == null || Number.isNaN(currentTs) || Number.isNaN(prevTs)) return true;

                    return Math.abs(currentTs - prevTs) > 30000;
                  })
                  .slice(0, 6)
                  .map(log => {
                    const role = log.user_role === 'admin' ? 'Admin' : (log.user_role === 'dispatcher' ? 'Dispatcher' : 'User');
                    const actor = resolveActivityActor(log);
                    
                    let displayDesc = log.description || "";
                    if (displayDesc.includes("logged in")) displayDesc = `${role} logged in`;
                    if (displayDesc.includes("User created")) displayDesc = "New user registered";
                    if (displayDesc.includes("User enabled")) displayDesc = "User account activated";
                    if (displayDesc.includes("User disabled")) displayDesc = "User account restricted";
                    if (displayDesc.includes("Drone created")) displayDesc = "Fleet asset added";
                    if (displayDesc.includes("Drone updated")) displayDesc = "Drone specs modified";
                    if (displayDesc.includes("Alert acknowledged")) displayDesc = "System alert cleared";
                    if (displayDesc.includes("Configuration updated")) displayDesc = "Settings synchronized";
                    if (displayDesc.includes("Delivery created")) displayDesc = "New delivery initiated";
                    
                    return (
                      <div key={log.id} className="activity-item" style={{ padding: "11px 16px" }}>
                        <div className="activity-icon" style={{ 
                          width: 28, height: 28, fontSize: 10,
                          background: actor.tone === 'admin'
                            ? 'rgba(168, 85, 247, 0.1)'
                            : actor.tone === 'system'
                              ? 'rgba(255, 209, 102, 0.12)'
                              : 'rgba(106, 228, 255, 0.1)',
                          color: actor.tone === 'admin'
                            ? '#a855f7'
                            : actor.tone === 'system'
                              ? '#ffd166'
                              : '#6ae4ff',
                          border: 'none'
                        }}>
                          {actor.initial}
                        </div>
                        <div className="activity-content">
                          <div className="activity-title" style={{ fontSize: 13, fontWeight: 600 }}>{displayDesc}</div>
                          <div className="activity-meta" style={{ fontSize: 11, opacity: 0.5 }}>
                            <span style={{ fontWeight: 700 }}>{actor.label}</span>
                            <span style={{ margin: '0 6px' }}>•</span>
                            <span>{fmtTimeAgo(log.created_at)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <div style={{ opacity: 0.1, marginBottom: 8 }}><List size={32} /></div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>No Recent Activity</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .status-strip {
          display: flex;
          gap: 24px;
          margin-top: 16px;
          padding: 8px 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .status-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: rgba(255,255,255,0.6);
        }
        .status-dot { width: 6px; height: 6px; border-radius: 50%; }
        .status-dot.online { background: #33d69f; box-shadow: 0 0 6px #33d69f; }
        .status-dot.warning { background: #ffd166; box-shadow: 0 0 6px rgba(255, 209, 102, 0.8); }
        .status-dot.error { background: #ff4d6d; box-shadow: 0 0 6px rgba(255, 77, 109, 0.85); }
        
        .pulse-dot {
          width: 8px;
          height: 8px;
          background-color: var(--primary);
          border-radius: 50%;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(106, 228, 255, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(106, 228, 255, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(106, 228, 255, 0); }
        }

        .quick-actions {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }
        .quick-action-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.05);
          padding: 12px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          text-decoration: none;
          color: white;
          transition: all 0.2s;
        }
        .quick-action-card:hover {
          background: rgba(255,255,255,0.07);
          transform: translateY(-2px);
          border-color: rgba(255,255,255,0.15);
        }
        .quick-action-card .icon-box {
          width: 36px; height: 36px; border-radius: 8px;
          display: flex; alignItems: center; justifyContent: center;
        }
        .quick-action-card .label { font-size: 13px; font-weight: 600; }

        .failure-summary { display: flex; flex-direction: column; gap: 8px; }
        .failure-summary-item { 
          display: flex; align-items: center; gap: 8px; font-size: 13px; 
          padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px;
        }
        .failure-summary-item .dot { width: 8px; height: 8px; border-radius: 50%; }
        .failure-summary-item .label { color: rgba(255,255,255,0.6); }
        .failure-summary-item .value { font-weight: 600; margin-left: auto; }

        .issue-list { display: flex; flex-direction: column; gap: 12px; }
        .issue-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 12px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .issue-header { display: flex; justify-content: space-between; align-items: center; }
        .badge { 
          padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase;
        }
        .badge-warning { background: rgba(255, 209, 102, 0.1); color: #ffd166; }
        .badge-critical { background: rgba(255, 77, 109, 0.1); color: #ff4d6d; }
        .timestamp { font-size: 11px; color: rgba(255,255,255,0.4); }
        .issue-content .title { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
        .issue-content .subtitle { font-size: 12px; color: rgba(255,255,255,0.5); }
        .issue-actions { margin-top: 4px; }

        .issue-row {
          display: flex;
          gap: 12px;
          padding: 10px;
          background: rgba(255,255,255,0.02);
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.04);
          position: relative;
          overflow: hidden;
          transition: all 0.2s;
        }
        .issue-row:hover {
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.1);
        }
        .severity-bar {
          width: 3px;
          border-radius: 3px;
          flex-shrink: 0;
        }
        .severity-bar.critical { background: #ff4d6d; box-shadow: 0 0 8px rgba(255,77,109,0.4); }
        .severity-bar.warning { background: #ffd166; }

        .activity-feed { display: flex; flex-direction: column; }
        .activity-item {
          display: flex; gap: 12px; padding: 12px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.03);
          transition: background 0.2s;
        }
        .activity-item:hover { background: rgba(255,255,255,0.02); }
        .activity-item:last-child { border-bottom: none; }
        .activity-icon {
          width: 32px; height: 32px; background: rgba(255, 255, 255, 0.05);
          color: rgba(255,255,255,0.7); border-radius: 50%; display: flex; align-items: center;
          justify-content: center; font-weight: 800; font-size: 12px; border: 1px solid rgba(255,255,255,0.1);
        }
        .activity-title { font-size: 13px; font-weight: 500; }
        .activity-meta { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px; }

        .empty-state {
          text-align: center;
          padding: 32px;
          color: rgba(255,255,255,0.4);
        }
        .empty-icon { margin-bottom: 16px; opacity: 0.2; }
        .empty-state h4 { margin: 0 0 4px 0; color: rgba(255,255,255,0.6); }
        .empty-state p { margin: 0; font-size: 13px; }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, icon, subValue, color, link, trend, statusText }) {
  return (
    <Link to={link} className="card stat-card-interactive" style={{ textDecoration: "none", color: "inherit", padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ 
          width: 36, height: 36, 
          background: `${color}15`, 
          color: color, 
          borderRadius: 10, 
          display: "flex", alignItems: "center", justifyContent: "center" 
        }}>
          {icon}
        </div>
        {(trend || statusText) && (
          <div style={{ textAlign: "right" }}>
            {statusText && <div style={{ fontSize: 10, fontWeight: 800, color: color, textTransform: "uppercase", marginBottom: 2 }}>{statusText}</div>}
            {trend && (
              <div style={{ color: trend === "up" ? "#ff4d6d" : "#33d69f", fontSize: 11, fontWeight: "bold" }}>
                {trend === "up" ? "▲" : "▼"} {trend === "up" ? "Attention" : "Stable"}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1 }}>{value}</div>
      <div className="stat-label" style={{ marginTop: 8, fontWeight: 700, fontSize: 14 }}>{label}</div>
      <div className="subtle" style={{ fontSize: 11, marginTop: 4, display: "flex", alignItems: "center", gap: 4, justifyContent: "space-between" }}>
        <span>{subValue}</span>
        <ArrowUpRight size={14} className="stat-hint" />
      </div>
      <style>{`
        .stat-card-interactive {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.05);
          position: relative;
          overflow: hidden;
        }
        .stat-card-interactive:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 24px rgba(0,0,0,0.3);
          border-color: ${color}66;
          background: rgba(255,255,255,0.02);
        }
        .stat-card-interactive::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0; height: 2px;
          background: ${color};
          opacity: 0.3;
        }
        .stat-hint {
          opacity: 0;
          transform: translate(-4px, 4px);
          transition: all 0.2s;
          color: ${color};
        }
        .stat-card-interactive:hover .stat-hint {
          opacity: 1;
          transform: translate(0, 0);
        }
      `}</style>
    </Link>
  );
}

function DroneIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M12 12l-6-6M12 12l6-6M12 12l-6 6M12 12l6 6" />
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

function fmtTimeAgo(dateStr) {
  if (!dateStr) return "N/A";
  const date = parseBackendDateTime(dateStr);
  if (!date) return "N/A";
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString();
}

function formatDroneName(id) {
  if (!id) return "Unknown";
  const greek = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon"];
  return `AF-${String(id).padStart(2, '0')} ${greek[(id - 1) % greek.length]}`;
}
