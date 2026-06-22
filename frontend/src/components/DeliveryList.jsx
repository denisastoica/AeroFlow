import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { useDeliveryUpdates } from "../hooks/useDeliveryUpdates";

const statusColors = {
  pending: "#ffd166",
  assigned: "#6ae4ff",
  picking_up: "#a78bfa",
  picked_up: "#7c5cff",
  in_transit: "#38bdf8",
  in_progress: "#7c5cff",
  delivered: "#33d69f",
  cancelled: "#adb5bd",
  failed: "#ff4d6d",
};

const statusLabels = {
  pending: "Pending",
  assigned: "Assigned",
  picking_up: "To Pickup",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  in_progress: "In Progress",
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Failed",
};

const priorityStyles = {
  normal: { color: "var(--text-muted)", label: "Standard", bg: "rgba(255,255,255,0.05)" },
  urgent: { color: "#ffd166", label: "Urgent", bg: "rgba(255,209,102,0.15)" },
  emergency: { color: "#ff4d6d", label: "Emergency", bg: "rgba(255,77,109,0.15)" },
};

export default function DeliveryList({ refreshTrigger, deliveries: deliveriesProp, sidebar }) {
  const toast = useToast();
  const [deliveries, setDeliveries] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(null);
  const [error, setError] = useState(null);
  const [assigningId, setAssigningId] = useState(null);

  const externalMode = Array.isArray(deliveriesProp);

    const fetchDeliveries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get("/deliveries/", {
        params: filter ? { status: filter } : {},
      });
            const raw = response.data;
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
      setDeliveries(list);
    } catch (err) {
      setError(getErrorMessage(err, "Error fetching deliveries"));
    } finally {
      setLoading(false);
    }
  }, [filter]);

    const fetchStats = useCallback(async () => {
    try {
      const response = await api.get("/deliveries/dashboard/stats");
      setStats(response.data);
    } catch (err) {
      console.error("Stats error:", err);
    }
  }, []);

    const assignDelivery = async (deliveryId) => {
    try {
      setAssigningId(deliveryId);
      await api.post(`/deliveries/${deliveryId}/assign`);
      toast.success(`Delivery #${deliveryId} assigned!`);
      fetchDeliveries();
      fetchStats();
    } catch (err) {
      toast.error(getErrorMessage(err, "Assignment error"));
    } finally {
      setAssigningId(null);
    }
  };

    const handleDeliveryUpdate = (update) => {
    setDeliveries((prev) => {
      const index = prev.findIndex((d) => d.id === update.delivery_id);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = { ...updated[index], ...update };
        return updated;
      }
      return prev;
    });
  };

  const { connected: wsConnected } = useDeliveryUpdates(handleDeliveryUpdate);

  useEffect(() => {
    if (externalMode) return;

    fetchDeliveries();
    fetchStats();

    const interval = setInterval(() => {
      fetchDeliveries();
      fetchStats();
    }, wsConnected ? 60000 : 10000);

    return () => clearInterval(interval);
  }, [externalMode, fetchDeliveries, fetchStats, refreshTrigger, wsConnected]);

  const filteredExternalDeliveries = useMemo(() => {
    if (!externalMode) return null;
    if (!filter) return deliveriesProp;
    return deliveriesProp.filter((d) => d?.status === filter);
  }, [deliveriesProp, externalMode, filter]);

  const listToRender = externalMode ? filteredExternalDeliveries || [] : deliveries;

  return (
    <div className="card theme-dispatcher" style={{ boxShadow: "none" }}>
      <div className="card-body">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Delivery List</h3>
          <div className="subtle" style={{ fontSize: 11, fontWeight: 700 }}>
            {externalMode ? "PREVIEW" : wsConnected ? "📡 LIVE CONNECTION" : "🔌 OFFLINE (POLLING)"}
          </div>
        </div>

            {!externalMode && stats && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", margin: "14px 0", gap: 10 }}>
          <div className="card" style={{ boxShadow: "none", background: "rgba(255,255,255,0.03)" }}>
            <div className="card-body" style={{ padding: 12, textAlign: "center" }}>
              <div className="subtle" style={{ fontSize: 10, textTransform: "uppercase" }}>Total</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{stats.total}</div>
            </div>
          </div>
          <div className="card" style={{ boxShadow: "none", background: "rgba(255,255,255,0.03)" }}>
            <div className="card-body" style={{ padding: 12, textAlign: "center" }}>
              <div className="subtle" style={{ fontSize: 10, textTransform: "uppercase" }}>Pending</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: statusColors.pending }}>{stats.pending}</div>
            </div>
          </div>
          <div className="card" style={{ boxShadow: "none", background: "rgba(255,255,255,0.03)" }}>
            <div className="card-body" style={{ padding: 12, textAlign: "center" }}>
              <div className="subtle" style={{ fontSize: 10, textTransform: "uppercase" }}>Assigned</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: statusColors.assigned }}>{stats.assigned}</div>
            </div>
          </div>
          <div className="card" style={{ boxShadow: "none", background: "rgba(255,255,255,0.03)" }}>
            <div className="card-body" style={{ padding: 12, textAlign: "center" }}>
              <div className="subtle" style={{ fontSize: 10, textTransform: "uppercase" }}>In Transit</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: statusColors.in_transit }}>{(stats.picking_up || 0) + (stats.in_transit || 0)}</div>
            </div>
          </div>
          <div className="card" style={{ boxShadow: "none", background: "rgba(255,255,255,0.03)" }}>
            <div className="card-body" style={{ padding: 12, textAlign: "center" }}>
              <div className="subtle" style={{ fontSize: 10, textTransform: "uppercase" }}>Delivered</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: statusColors.delivered }}>{stats.delivered}</div>
            </div>
          </div>
        </div>
      )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 14px" }}>
        <button className="btn" type="button" onClick={() => setFilter(null)} style={{ background: filter === null ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)" }}>
          All
        </button>
        {Object.keys(statusLabels).map((s) => (
          <button
            className="btn"
            type="button"
            key={s}
            onClick={() => setFilter(s)}
            style={{
              borderColor: filter === s ? "rgba(106, 228, 255, 0.40)" : "rgba(255,255,255,0.14)",
              background: filter === s ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
            }}
          >
            {statusLabels[s]}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {!externalMode && loading && !deliveries.length && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {[1,2,3].map(i => (
            <div key={i} className="skeleton-card" style={{ height: 140 }}>
              <div className="skeleton-text" style={{ width: '40%', height: 16 }} />
              <div className="skeleton-text" style={{ width: '60%', height: 12, marginTop: 10 }} />
              <div className="skeleton-text" style={{ width: '80%', height: 12, marginTop: 6 }} />
            </div>
          ))}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {listToRender.map((d) => {
          const pStyle = priorityStyles[d.priority] || priorityStyles.normal;
          return (
          <div key={d.id} className="card" style={{
            boxShadow: "none",
            borderLeft: d.priority === "emergency" ? "3px solid #ff4d6d" : d.priority === "urgent" ? "3px solid #ffd166" : "none",
          }}>
            <div className="card-body" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 900 }}>#{d.id}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {d.priority && d.priority !== "normal" && (
                    <span
                      className="badge"
                      style={{
                        background: pStyle.bg,
                        color: pStyle.color,
                        borderColor: pStyle.border,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {pStyle.icon} {pStyle.label}
                    </span>
                  )}
                  <span
                    className="badge"
                    style={{
                      borderColor: `${statusColors[d.status] || '#adb5bd'}40`,
                      background: `${statusColors[d.status] || '#adb5bd'}22`,
                      color: statusColors[d.status] || '#adb5bd',
                    }}
                  >
                    {statusLabels[d.status] || d.status}
                  </span>
                </div>
              </div>
              <div className="subtle" style={{ fontSize: 13, marginTop: 8 }}>
                Status: <span style={{ color: statusColors[d.status] || "inherit", fontWeight: 700 }}>{statusLabels[d.status] || d.status}</span>
              </div>
              <div className="subtle" style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 10 }}>
                <span>{d.package_type || "standard"}</span>
                {d.weight_kg && <span>{d.weight_kg} kg</span>}
              </div>
              {d.notes && (
                <div className="subtle" style={{ fontSize: 12, marginTop: 4, fontStyle: "italic" }}>
                  {d.notes}
                </div>
              )}

              {!externalMode && d.status === "pending" && (
                <button className="btn btn-primary" type="button" disabled={assigningId === d.id} onClick={() => assignDelivery(d.id)} style={{ width: "100%", marginTop: 12, fontSize: 13 }}>
                  {assigningId === d.id ? "Assigning..." : "Assign Manually"}
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}