import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { deliveriesAPI, geocodingAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import DeliveryForm from "./DeliveryForm";
import DeliveryTracker from "./DeliveryTracker";
import { useDeliveryUpdates } from "../hooks/useDeliveryUpdates";

import ConfirmDeliveryModal from "./ConfirmDeliveryModal";
import ProofOfDelivery from "./ProofOfDelivery";
import DeliveryDetailsModal from "./DeliveryDetailsModal";
import { formatBackendDateTime } from "../utils/datetime";

const priorityStyles = {
  low: { color: "var(--muted2)", icon: "" },
  normal: { color: "var(--muted2)", icon: "" },
  urgent: { color: "var(--warning)", icon: "" },
  high: { color: "#ffa500", icon: "" },
  emergency: { color: "var(--danger)", icon: "" },
};

const CustomerDashboard = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [trackingId, setTrackingId] = useState(null);
  const [confirmingDelivery, setConfirmingDelivery] = useState(null);
  const [viewingDetailsId, setViewingDetailsId] = useState(null);
  const [viewingProofId, setViewingProofId] = useState(null);
  const [addressCache, setAddressCache] = useState({});
  const formOuterRef = useRef(null);
  const trackerRef = useRef(null);
  const [ordersPanelHeight, setOrdersPanelHeight] = useState(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");

  const fetchDashboard = async (isSilent = false) => {
    try {
      if (!dashboard && !isSilent) setLoading(true);
      const response = await deliveriesAPI.getDashboardCustomer();
      setDashboard(response.data);
      setError(null);
    } catch (err) {
      const msg = getErrorMessage(err, "Failed to load dashboard");
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

    const handleDeliveryWsUpdate = (data) => {
            const relevantTypes = ["delivery_update", "delivery_confirmed"];
    if (relevantTypes.includes(data?.type)) {
      fetchDashboard(true);
    }
  };
  const { connected: isWsConnected } = useDeliveryUpdates(handleDeliveryWsUpdate);

  useEffect(() => {
    fetchDashboard();
        const interval = setInterval(() => fetchDashboard(true), 20000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

    useEffect(() => {
    if (!dashboard?.recent_deliveries) return;
    const toResolve = [];
    dashboard.recent_deliveries.forEach((d) => {
      if (!d.dest_address && d.dest_lat && d.dest_lon)
        toResolve.push({ lat: d.dest_lat, lon: d.dest_lon });
      if (!d.pickup_address && d.pickup_lat && d.pickup_lon)
        toResolve.push({ lat: d.pickup_lat, lon: d.pickup_lon });
    });
        const seen = new Set();
    const unique = toResolve.filter(({ lat, lon }) => {
      const k = `${lat},${lon}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (unique.length === 0) return;

        let cancelled = false;
    const resolveNext = async (index) => {
      if (cancelled || index >= unique.length) return;
      const { lat, lon } = unique[index];
      const key = `${lat},${lon}`;
      setAddressCache((prev) => {
        if (prev[key] !== undefined) return prev;
        return { ...prev, [key]: null };
      });
      try {
        const res = await geocodingAPI.reverse(lat, lon);
        const addr = res.data?.address || res.data?.display_name || null;
        if (addr && !cancelled) {
          setAddressCache((prev) => ({ ...prev, [key]: addr }));
        }
      } catch {
              }
      resolveNext(index + 1);
    };

    resolveNext(0);
    return () => { cancelled = true; };
  }, [dashboard]);

  useEffect(() => {
    if (trackingId && trackerRef.current) {
      setTimeout(() => {
        trackerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [trackingId]);

  useEffect(() => {
    const formOuter = formOuterRef.current;
    if (!formOuter) return undefined;
    let resizeObserver;

    const syncOrdersHeight = () => {
      if (window.innerWidth <= 960) {
        setOrdersPanelHeight(null);
        return;
      }

      const nextHeight = Math.ceil(formOuter.getBoundingClientRect().height);
      setOrdersPanelHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    syncOrdersHeight();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(syncOrdersHeight);
      resizeObserver.observe(formOuter);
    }
    window.addEventListener("resize", syncOrdersHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncOrdersHeight);
    };
  }, [dashboard]);

  if (loading && !dashboard) {
    return (
      <div className="stack">
        <div className="page-header">
          <div>
            <h1>My Deliveries</h1>
            <p className="subtle">Welcome, {user?.name}!</p>
          </div>
        </div>
        <div className="grid grid-4">
          {[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-stat" />)}
        </div>
        <div className="grid grid-2 section">
          <div className="skeleton skeleton-card" style={{ height: 240 }} />
          <div className="skeleton skeleton-card" style={{ height: 240 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="stack theme-customer">
      <div className="page-header">
        <div>
          <h1>My Deliveries</h1>
          <p className="subtle">Welcome, {user?.name}! Here you can track and manage your delivery orders.</p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {dashboard && (
        <>
          <div className="grid grid-6">
            <div className="stat-card stat-card--total">
              <div className="stat-icon">📊</div>
              <div className="stat-value">{dashboard.total}</div>
              <div className="stat-label">Total Orders</div>
              {(() => {
                const parts = [];
                if ((dashboard.assigned || 0) > 0) parts.push(`${dashboard.assigned} assigned`);
                if ((dashboard.failed || 0) > 0) parts.push(`${dashboard.failed} failed`);
                return parts.length > 0
                  ? <div className="stat-sub">{parts.join(' · ')}</div>
                  : null;
              })()}
            </div>
            <div className="stat-card stat-card--pending" style={{ cursor: "pointer" }} onClick={() => { setOrderFilter("pending"); setOrderSearch(""); document.querySelector('.customer-dashboard-panel--orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              <div className="stat-icon">⏳</div>
              <div className="stat-value">{dashboard.pending}</div>
              <div className="stat-label">Pending</div>
            </div>
            <div className="stat-card stat-card--transit" style={{ cursor: "pointer" }} onClick={() => { setOrderFilter("transit"); setOrderSearch(""); document.querySelector('.customer-dashboard-panel--orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              <div className="stat-icon">🚁</div>
              <div className="stat-value">{(dashboard.picking_up || 0) + (dashboard.in_transit || 0)}</div>
              <div className="stat-label">In Transit</div>
            </div>
            <div className="stat-card stat-card--delivered" style={{ cursor: "pointer" }} onClick={() => { setOrderFilter("delivered"); setOrderSearch(""); document.querySelector('.customer-dashboard-panel--orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              <div className="stat-icon">🏁</div>
              <div className="stat-value">{dashboard.delivered || 0}</div>
              <div className="stat-label">Delivered</div>
            </div>
            <div className="stat-card stat-card--confirmed" style={{ cursor: "pointer" }} onClick={() => { setOrderFilter("confirmed"); setOrderSearch(""); document.querySelector('.customer-dashboard-panel--orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              <div className="stat-icon">✅</div>
              <div className="stat-value">{dashboard.confirmed || 0}</div>
              <div className="stat-label">Confirmed Receipts</div>
            </div>
            <div className="stat-card stat-card--cancelled" style={{ cursor: "pointer" }} onClick={() => { setOrderFilter("cancelled"); setOrderSearch(""); document.querySelector('.customer-dashboard-panel--orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
              <div className="stat-icon">🚫</div>
              <div className="stat-value">{dashboard.cancelled || 0}</div>
              <div className="stat-label">Cancelled</div>
            </div>
          </div>

                    {trackingId && (
            <div ref={trackerRef} style={{ marginBottom: 32, animation: "slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }}>
              <DeliveryTracker
                deliveryId={trackingId}
                onClose={() => setTrackingId(null)}
              />
            </div>
          )}

          <div className="grid grid-2 section customer-dashboard-panels" style={{ gap: 32 }}>
            <div
              ref={formOuterRef}
              className="customer-dashboard-panel customer-dashboard-panel--form"
            >
              <div className="section-header">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="section-icon">📦</div>
                  <h2 style={{ margin: 0 }}>Create New Delivery</h2>
                </div>
              </div>
              <div className="order-filter-bar" style={{ visibility: "hidden", pointerEvents: "none", flexShrink: 0 }} aria-hidden="true" />
              <div
                className="card card--form-wrap customer-dashboard-panel__shell customer-dashboard-panel__shell--form"
              >
                <DeliveryForm onDeliveryCreated={() => setRefreshTrigger((p) => p + 1)} />
              </div>
            </div>

            <div
              className="customer-dashboard-panel customer-dashboard-panel--orders"
              style={ordersPanelHeight ? { maxHeight: ordersPanelHeight, overflow: "hidden" } : undefined}
            >
              <div className="section-header">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="section-icon">📜</div>
                  <h2 style={{ margin: 0 }}>Recent Orders</h2>
                </div>
                <span className="subtle" style={{ fontSize: 13 }}>{dashboard.recent_deliveries.length} entries</span>
              </div>
              <div className="order-filter-bar">
                <div className="order-filter-group">
                  {[
                    { key: "all", label: "All" },
                    { key: "pending", label: "Pending" },
                    { key: "transit", label: "In Transit" },
                    { key: "delivered", label: "Delivered" },
                    { key: "confirmed", label: "Confirmed" },
                    { key: "cancelled", label: "Cancelled" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      className={`order-filter-btn${orderFilter === key ? " active" : ""}`}
                      onClick={() => { setOrderFilter(key); setOrderSearch(""); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="order-search-wrap">
                  <span className="order-search-icon">🔍</span>
                  <input
                    className="order-search-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="Order ID…"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value.replace(/\D/g, ""))}
                  />
                  {orderSearch && (
                    <button className="order-search-clear" onClick={() => setOrderSearch("")} aria-label="Clear search">&times;</button>
                  )}
                </div>
              </div>
              <div
                className="card customer-dashboard-panel__body customer-dashboard-panel__shell customer-dashboard-panel__shell--orders"
              >
                {dashboard.recent_deliveries.length > 0 ? (
                  <div className="delivery-list-container">
                  {(() => {
                    const filtered = dashboard.recent_deliveries.filter((d) => {
                      if (orderSearch) return String(d.id).includes(orderSearch);
                      if (orderFilter === "all") return true;
                      if (orderFilter === "pending") return ["pending", "created", "assigned"].includes(d.status);
                      if (orderFilter === "transit") return ["picking_up", "picked_up", "in_transit", "in_progress"].includes(d.status);
                      if (orderFilter === "delivered") return d.status === "delivered" && !d.confirmed_at;
                      if (orderFilter === "confirmed") return d.status === "delivered" && !!d.confirmed_at;
                      if (orderFilter === "cancelled") return ["cancelled", "failed"].includes(d.status);
                      return true;
                    });
                    if (filtered.length === 0) {
                      return (
                        <div className="empty-state" style={{ padding: "40px 0" }}>
                          <div className="empty-icon">🔍</div>
                          <p>No orders in this category.</p>
                        </div>
                      );
                    }
                    return filtered.map((d) => {
                    const isTrackable = ["assigned", "picking_up", "picked_up", "in_transit", "in_progress"].includes(d.status);
                    const isTracking = trackingId === d.id;
                    const isDelivered = d.status === "delivered";
                    const isConfirmed = !!d.confirmed_at;
                    const isFailed = d.status === "failed";

                                        const destKey = d.dest_lat && d.dest_lon ? `${d.dest_lat},${d.dest_lon}` : null;
                    const resolvedDest = d.dest_address || (destKey && addressCache[destKey]) || null;
                    const destDisplay = resolvedDest
                      ? resolvedDest
                      : (d.dest_lat && d.dest_lon)
                        ? `${Number(d.dest_lat).toFixed(4)}, ${Number(d.dest_lon).toFixed(4)}`
                        : "N/A";

                                        const pickupKey = d.pickup_lat && d.pickup_lon ? `${d.pickup_lat},${d.pickup_lon}` : null;
                    const resolvedPickup = d.pickup_address || (pickupKey && addressCache[pickupKey]) || null;
                    const pickupDisplay = resolvedPickup
                      ? resolvedPickup
                      : (d.pickup_lat && d.pickup_lon)
                        ? `${Number(d.pickup_lat).toFixed(4)}, ${Number(d.pickup_lon).toFixed(4)}`
                        : "N/A";
                    
                                                            const etaMin = d.estimated_duration_h ? (d.estimated_duration_h * 60).toFixed(0) : null;

                    return (
                      <div
                        key={d.id}
                        className={`card delivery-card-premium ${isTracking ? "active" : ""} ${isConfirmed ? "confirmed" : ""}`}
                      >
                        <div className="delivery-card-header">
                          <div className="id-badge">#{d.id}</div>
                          <div style={{ flex: 1, marginLeft: 12 }}>
                            <div className="created-date">
                              {formatBackendDateTime(d.created_at, { locale: "en-US", options: { dateStyle: "medium", timeStyle: "short" }, fallback: "Unavailable" })}
                            </div>
                            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                              {d.priority && d.priority !== 'normal' && (
                                <span className={`priority-badge priority-badge--${d.priority}`}>
                                  {d.priority}
                                </span>
                              )}
                              {isTrackable && (
                                <span className="eta-badge-small">
                                  ETA {etaMin ? `${etaMin} min` : '—'}
                                </span>
                              )}
                            </div>
                          </div>
                          <StatusBadge status={d.status} />
                        </div>

                        <div className="delivery-card-body">
                          <div className="info-grid-compact">
                            <div className="info-item">
                              <span className="label">📍 Pickup</span>
                              <span className="value truncate" title={pickupDisplay}>
                                {pickupDisplay}
                              </span>
                            </div>
                            <div className="info-item">
                              <span className="label">🎯 Destination</span>
                              <span className="value truncate" title={destDisplay}>
                                {destDisplay}
                              </span>
                            </div>
                            <div className="info-item">
                              <span className="label">Package</span>
                              <span className="value" style={{ textTransform: "capitalize" }}>{d.package_type || "Standard"}</span>
                            </div>
                            <div className="info-item">
                              <span className="label">Distance</span>
                              <span className="value">
                                {d.estimated_distance_km != null
                                  ? `${Number(d.estimated_distance_km).toFixed(1)} km`
                                  : "N/A"}
                              </span>
                            </div>
                            {isConfirmed && (
                              <div className="info-item">
                                <span className="label">Receipt</span>
                                <span className="value" style={{ color: "var(--success)" }}>Receipt confirmed ✅</span>
                              </div>
                            )}
                          </div>

                          {isDelivered && !isConfirmed && (
                            <div className="delivery-confirmation-hint">
                              Use the 6-digit code from your email to confirm the package receipt.
                            </div>
                          )}
                        </div>

                        <div className="delivery-card-actions">
                          {isConfirmed ? (
                            <button 
                              className="btn btn-sm btn-outline-success" 
                              onClick={() => setViewingProofId(d.id)}
                            >
                              📄 View Proof
                            </button>
                          ) : isDelivered ? (
                            <>
                              <button 
                                className="btn btn-sm btn-outline"
                                onClick={() => setViewingDetailsId(d.id)}
                              >
                                🔎 Details
                              </button>
                              <button 
                                className="btn btn-sm btn-success" 
                                onClick={() => setConfirmingDelivery(d.id)}
                              >
                                ✅ Confirm
                              </button>
                            </>
                          ) : isTrackable ? (
                            <button 
                              className={`btn btn-sm ${isTracking ? "btn-outline" : "btn-primary"}`}
                              onClick={() => setTrackingId(isTracking ? null : d.id)}
                            >
                              {isTracking ? "✕ Close" : "📡 Track Live"}
                            </button>
                          ) : isFailed ? (
                            <>
                              <div className="delivery-failed-summary" style={{ flex: 1 }}>
                                <div className="delivery-failed-summary__title">Delivery Failed</div>
                                {d.failure_reason && (
                                  <div className="delivery-failed-summary__reason">Reason: {d.failure_reason}</div>
                                )}
                              </div>
                              <button 
                                className="btn btn-sm btn-outline-danger" 
                                onClick={() => setViewingDetailsId(d.id)}
                                style={{ marginLeft: 8 }}
                              >
                                🔎 Details
                              </button>
                            </>
                          ) : (
                            <div className="subtle" style={{ fontSize: 13, fontStyle: "italic" }}>
                              Awaiting assignment
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                  })()}
                  </div>
                ) : (
                  <div className="empty-state customer-dashboard-panel__empty-state">
                    <div className="empty-icon">📦</div>
                    <p>No deliveries recorded yet.</p>
                    <button className="btn btn-sm btn-outline" onClick={() => {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      setTimeout(() => {
                        const firstInput = document.querySelector('.customer-dashboard-panel--form input');
                        if (firstInput) firstInput.focus();
                      }, 500);
                    }}>
                      Create a delivery
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {confirmingDelivery && (
        <ConfirmDeliveryModal 
          deliveryId={confirmingDelivery} 
          onClose={() => setConfirmingDelivery(null)}
          onConfirm={() => fetchDashboard(true)}
        />
      )}

      {viewingDetailsId && (
        <DeliveryDetailsModal
          deliveryId={viewingDetailsId}
          onClose={() => setViewingDetailsId(null)}
          onConfirm={(deliveryId) => {
            setViewingDetailsId(null);
            setConfirmingDelivery(deliveryId);
          }}
          onViewProof={(deliveryId) => {
            setViewingDetailsId(null);
            setViewingProofId(deliveryId);
          }}
        />
      )}

      {viewingProofId && (
        <ProofOfDelivery
          deliveryId={viewingProofId}
          onClose={() => setViewingProofId(null)}
        />
      )}
    </div>
  );
}

const statusConfig = {
  pending: { color: "#ffd166", label: "Pending" },
  assigned: { color: "#6ae4ff", label: "Assigned" },
  picking_up: { color: "#a78bfa", label: "Picking Up" },
  picked_up: { color: "#7c5cff", label: "Picked Up" },
  in_transit: { color: "#38bdf8", label: "In Transit" },
  in_progress: { color: "#7c5cff", label: "In Flight" },
  delivered: { color: "#33d69f", label: "Delivered" },
  cancelled: { color: "#adb5bd", label: "Cancelled" },
  failed: { color: "#ff4d6d", label: "Failed" },
};

const StatusBadge = ({ status }) => {
  const cfg = statusConfig[status] || { color: "#adb5bd", label: status };
  return (
    <span className="badge" style={{
      background: "rgba(255,255,255,0.08)",
      borderColor: "rgba(255,255,255,0.14)",
      color: cfg.color,
      fontSize: 11,
    }}>
      {cfg.label}
    </span>
  );
};

export default CustomerDashboard;
