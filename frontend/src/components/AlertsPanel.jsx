import React, { useEffect, useState } from "react";
import api, { weatherAPI } from "../services/api";
import { formatBackendTime } from "../utils/datetime";

const SEVERITY_COLORS = {
  info: "#6ae4ff",
  warning: "#ffd166",
  critical: "#ff4d6d",
};

export default function AlertsPanel({ onClose }) {
  const [alerts, setAlerts] = useState([]);
  const [alertsSummary, setAlertsSummary] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [warnings, setWarnings] = useState({ general: [], nowcast: [] });
  const [mainTab, setMainTab] = useState("system");
  const [systemFilter, setSystemFilter] = useState("all");
  const [anmFilter, setAnmFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      setLoading(true);
        try {
          const [resAlerts, resWarnings, resSummary, resHealth] = await Promise.all([
            api.get("/alerts/?limit=500"),
            weatherAPI.getWarnings().catch(e => {
              console.error("Failed to fetch warnings:", e);
              return { data: { general: [], nowcast: [] } };
            }),
            api.get("/alerts/summary").catch(() => ({ data: { total_active: 0 } })),
            api.get("/system/health").catch(() => ({ data: { components: {} } }))
          ]);
          const rawAlerts = resAlerts.data;
          if (mounted) {
            const items = Array.isArray(rawAlerts) ? rawAlerts : Array.isArray(rawAlerts?.items) ? rawAlerts.items : []; 
            setAlerts(items.filter(a => a.status !== "resolved"));
            setWarnings(resWarnings.data || { general: [], nowcast: [] });
            setAlertsSummary(resSummary.data);
            setSystemHealth(resHealth.data);
          }
        } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchData();
    return () => { mounted = false; };
  }, []);

  const handleAcknowledge = async (id) => {
    try {
      await api.patch(`/alerts/${id}/acknowledge`);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  const filteredAlerts = systemFilter === "all" ? alerts : alerts.filter(a => a.severity === systemFilter);

    const filteredNowcast = warnings.nowcast || [];
  let filteredGeneral = warnings.general || [];
  
  if (anmFilter === "info") {
        filteredGeneral = filteredGeneral.filter(w => w.culoare === 'Galben');
  } else if (anmFilter === "warning") {
        filteredGeneral = filteredGeneral.filter(w => w.culoare === 'Portocaliu');
  } else if (anmFilter === "critical") {
        filteredGeneral = filteredGeneral.filter(w => w.culoare === 'Rosu');
  }

    const finalNowcast = (anmFilter === "all" || anmFilter === "critical") ? filteredNowcast : [];

  return (
    <div className="alerts-panel-modal-bg">
      <div className="alerts-panel-modal theme-dispatcher" style={{ display: "flex", flexDirection: "column", maxHeight: '90vh', overflow: 'hidden' }}>
        <button className="btn" style={{ position: "absolute", top: 18, right: 18, zIndex: 2 }} onClick={onClose}>Close</button>
        <div className="alerts-panel-header">
          <h2 style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 15 }}>
            <span style={{ fontSize: 28 }}>⚠️</span> Operations Center
          </h2>
          
                    <div style={{ display: "flex", gap: 10, borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 12, marginBottom: 15 }}>
            <button 
              style={{
                background: mainTab === "system" ? "rgba(255,255,255,0.15)" : "transparent",
                border: "none", color: "white", padding: "8px 16px", borderRadius: "6px",
                fontWeight: mainTab === "system" ? 700 : 500,
                cursor: "pointer", transition: "0.2s"
              }}
              onClick={() => setMainTab("system")}
            >
              🚁 System Alerts
            </button>
            <button 
              style={{
                background: mainTab === "anm" ? "rgba(255,255,255,0.15)" : "transparent",
                border: "none", color: "white", padding: "8px 16px", borderRadius: "6px",
                fontWeight: mainTab === "anm" ? 700 : 500,
                cursor: "pointer", transition: "0.2s",
                display: "flex", alignItems: "center", gap: 6
              }}
              onClick={() => setMainTab("anm")}
            >
              🌪️ ANM Warnings
              {(warnings.nowcast?.length > 0 || warnings.general?.length > 0) && (
                <span style={{ background: "#ff4d6d", padding: "2px 6px", borderRadius: "10px", fontSize: 11, fontWeight: 900 }}>
                  {(warnings.nowcast?.length || 0) + (warnings.general?.length || 0)}
                </span>
              )}
            </button>
          </div>

                    {mainTab === "system" ? (
            <div className="alerts-panel-filters">
              <button className={systemFilter === "all" ? "active" : ""} onClick={() => setSystemFilter("all")}>All</button>
              <button className={systemFilter === "info" ? "active" : ""} onClick={() => setSystemFilter("info")}>Info</button>
              <button className={systemFilter === "warning" ? "active" : ""} onClick={() => setSystemFilter("warning")}>Warnings</button>
              <button className={systemFilter === "critical" ? "active" : ""} onClick={() => setSystemFilter("critical")}>Critical</button>
            </div>
          ) : (
            <div className="alerts-panel-filters">
              <button className={anmFilter === "all" ? "active" : ""} onClick={() => setAnmFilter("all")}>All</button>
              <button className={anmFilter === "info" ? "active" : ""} onClick={() => setAnmFilter("info")}>Code Yellow</button>
              <button className={anmFilter === "warning" ? "active" : ""} onClick={() => setAnmFilter("warning")}>Code Orange</button>
              <button className={anmFilter === "critical" ? "active" : ""} onClick={() => setAnmFilter("critical")}>Red & Nowcast</button>
            </div>
          )}
        </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center" }}>Loading data...</div>
          ) : (
            <div style={{ padding: "0 18px 18px 18px", overflowY: "auto", flex: 1 }} className="custom-scroll">
                            <div style={{ 
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, 
                marginBottom: 20, padding: 12, background: "rgba(255,255,255,0.03)", 
                borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" 
              }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.5, textTransform: "uppercase" }}>Unresolved Incidents</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: (alertsSummary?.total_active || alerts.length) > 0 ? "#ff4d6d" : "#33d69f" }}>{alertsSummary?.total_active || alerts.length}</div>
                </div>
                <div style={{ textAlign: "center", borderLeft: "1px solid rgba(255,255,255,0.1)", borderRight: "1px solid rgba(255,255,255,0.1)" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.5, textTransform: "uppercase" }}>ANM Warnings</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: (warnings.nowcast?.length || 0) + (warnings.general?.length || 0) > 0 ? "#ffd166" : "#33d69f" }}>
                    {(warnings.nowcast?.length || 0) + (warnings.general?.length || 0)}
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.5, textTransform: "uppercase" }}>System Load</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: systemHealth?.components?.system?.status === "online" ? "#33d69f" : "#ffd166" }}>{systemHealth?.components?.system?.status === "online" ? "Nominal" : "Degraded"}</div>
                </div>
              </div>
                            {mainTab === "anm" ? (
                                (finalNowcast.length === 0 && filteredGeneral.length === 0) ? (
                  <div style={{ padding: 60, textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.5 }}>🌤️</div>
                    <div className="subtle">No active official warnings matching this filter.</div>
                  </div>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0 }}>
                                        {finalNowcast.map((w, i) => (
                      <li key={`nowcast-${i}`} style={{
                        background: "rgba(255, 77, 109, 0.1)",
                        borderLeft: `4px solid #ff4d6d`,
                        marginBottom: 10,
                        borderRadius: 8,
                        padding: "14px 18px",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ color: "#ff4d6d", fontWeight: "bold", fontSize: 13 }}>NOWCASTING SEVER</span>
                          <span className="subtle" style={{ fontSize: 12 }}>Exp: {w.data_expirarii}</span>
                        </div>
                        <div style={{ fontWeight: "bold", marginBottom: 4 }}>{w.fenomene}</div>
                        <div className="subtle" style={{ fontSize: 13, marginBottom: 6 }}>📍 {w.zone}</div>
                        <div style={{ fontSize: 13, opacity: 0.9 }}>{w.mesaj}</div>
                      </li>
                    ))}
                                        {filteredGeneral.map((w, i) => {
                      const colorMap = { "Galben": "#ffd166", "Portocaliu": "#f77f00", "Rosu": "#d62828" };
                      const bgColorMap = { "Galben": "rgba(255, 209, 102, 0.05)", "Portocaliu": "rgba(247, 127, 0, 0.1)", "Rosu": "rgba(214, 40, 40, 0.15)" };
                      const color = colorMap[w.culoare] || "#fff";
                      const bg = bgColorMap[w.culoare] || "rgba(255,255,255,0.02)";
                      return (
                        <li key={`gen-${i}`} style={{
                          background: bg, borderLeft: `4px solid ${color}`,
                          marginBottom: 10, borderRadius: 8, padding: "14px 18px",
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ color: color, fontWeight: "bold", fontSize: 13 }}>
                              {w.tip.toUpperCase()} - COD {w.culoare.toUpperCase()}
                            </span>
                            <span className="subtle" style={{ fontSize: 12 }}>Exp: {w.data_expirarii}</span>
                          </div>
                          <div style={{ fontWeight: "bold", marginBottom: 4 }}>{w.fenomene}</div>
                          <div className="subtle" style={{ fontSize: 13, marginBottom: 6 }}>📍 {w.zone}</div>
                          <div style={{ fontSize: 13, opacity: 0.9 }}>{w.mesaj}</div>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                                filteredAlerts.length === 0 ? (
                  <div style={{ padding: 60, textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.5 }}>✓</div>
                    <div className="subtle">No active operational alerts.</div>
                  </div>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {filteredAlerts.map(alert => (
                      <li key={alert.id} className={`alert-row alert-row--${alert.severity}`} style={{ 
                        borderLeft: `4px solid ${SEVERITY_COLORS[alert.severity]}`,
                        background: "rgba(255,255,255,0.02)",
                        marginBottom: 10,
                        borderRadius: 8,
                        padding: "14px 18px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 16
                      }}>
                        <div className="alert-row-main" style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                            <span className="alert-row-severity" style={{ 
                              color: SEVERITY_COLORS[alert.severity], fontWeight: 900, fontSize: 11, letterSpacing: "0.05em"
                            }}>{alert.severity.toUpperCase()}</span>
                            <span className="alert-row-date" style={{ fontSize: 11, opacity: 0.5 }}>
                              {alert.created_at ? formatBackendTime(alert.created_at, { locale: "en-US", fallback: "" }) : ""}
                            </span>
                          </div>
                          <div className="alert-row-msg" style={{ fontSize: 15, fontWeight: 500 }}>{alert.message}</div>
                          {alert.details && <div className="subtle" style={{ fontSize: 12, marginTop: 4 }}>{alert.details}</div>}
                        </div>
                        <div className="alert-row-actions">
                          <button 
                            className="btn btn-primary" onClick={() => handleAcknowledge(alert.id)}
                            style={{ fontSize: 13, padding: "8px 16px" }}
                          >
                            Acknowledge
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          )}
        </div>
      </div>
  );
}
