import React, { useEffect, useState, useCallback, useRef } from "react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useWebSocketMonitor } from "../hooks/useWebSocketMonitor";
import DeliveryTracker from "./DeliveryTracker";

export default function CustomerMap() {
  const { user } = useAuth();
  const [activeDeliveries, setActiveDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);

    const selectedDeliveryIdRef = useRef(selectedDeliveryId);
  useEffect(() => { selectedDeliveryIdRef.current = selectedDeliveryId; }, [selectedDeliveryId]);

  const fetchActiveDeliveries = useCallback(async () => {
    try {
      const res = await api.get("/deliveries/", {
        params: { status: "assigned,picking_up,picked_up,in_transit,in_progress" }
      });
      const filtered = res.data.items.filter(d => d.customer_id === user.id);
      setActiveDeliveries(filtered);
      
            if (!selectedDeliveryIdRef.current && filtered.length > 0) {
        setSelectedDeliveryId(filtered[0].id);
      }
    } catch (err) {
      console.error("Error fetching customer deliveries:", err);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    fetchActiveDeliveries();
  }, [fetchActiveDeliveries]);

      const { isConnected } = useWebSocketMonitor(null);

  useEffect(() => {
    setWsConnected(isConnected);
  }, [isConnected]);

    useEffect(() => {
    if (wsConnected) return;
    const interval = setInterval(fetchActiveDeliveries, 10000);
    return () => clearInterval(interval);
  }, [wsConnected, fetchActiveDeliveries]);

  const selectedDelivery = activeDeliveries.find(d => d.id === selectedDeliveryId);

  if (loading && activeDeliveries.length === 0) {
    return (
      <div className="stack" style={{ padding: 60, textAlign: "center" }}>
        <div className="spinner" style={{ margin: "0 auto" }} />
        <p className="subtle" style={{ marginTop: 20 }}>Initializing tracking systems...</p>
      </div>
    );
  }

  return (
    <div className="stack theme-customer full-height-map">
      <header className="page-header" style={{ marginBottom: 0, padding: "10px 24px", minHeight: "auto", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="header-icon-circle" style={{ width: 36, height: 36, fontSize: 18 }}>🗺️</div>
          <div>
            <h1 style={{ fontSize: 18, margin: 0 }}>My Map Tracking</h1>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {wsConnected && <span className="badge badge--live-pulsing" style={{ padding: "4px 10px", fontSize: 10 }}>LIVE SATELLITE</span>}
          <div className="user-badge-mini">{user?.name}</div>
        </div>
      </header>

      <div className="map-layout-premium">
        <aside className="map-sidebar-premium">
          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <h3>Active Deliveries</h3>
              <span className="count-pill">{activeDeliveries.length}</span>
            </div>
            <div className="sidebar-list scrollable">
              {activeDeliveries.length === 0 ? (
                <div className="empty-sidebar-state">
                  <div className="icon">📦</div>
                  <p>No active deliveries right now.</p>
                  <a href="/dashboard" className="btn btn-xs btn-outline">Go to My Deliveries</a>
                </div>
              ) : (
                activeDeliveries.map(d => (
                  <button
                    key={d.id}
                    className={`sidebar-item ${selectedDeliveryId === d.id ? "active" : ""}`}
                    onClick={() => setSelectedDeliveryId(d.id)}
                  >
                    <div className="item-status-indicator" style={{ background: "var(--accent)" }} />
                    <div className="item-info">
                      <div className="item-title">Order #{d.id}</div>
                      <div className="item-subtitle">{d.status.replace(/_/g, ' ')}</div>
                    </div>
                    {selectedDeliveryId === d.id && <div className="active-chevron">›</div>}
                  </button>
                ))
              )}
            </div>
          </div>
          
          {selectedDelivery && (
            <div className="sidebar-section info-card-section">
              <div className="sidebar-section-head">
                <h3>Delivery Details</h3>
              </div>
              <div className="sidebar-info-card">
                <div className="info-row">
                  <span className="label">Status</span>
                  <span className="value status-text">{selectedDelivery.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="info-row">
                  <span className="label">Distance</span>
                  <span className="value">{selectedDelivery.estimated_distance_km?.toFixed(1)} km</span>
                </div>
                <div className="info-row">
                  <span className="label">Package</span>
                  <span className="value">{selectedDelivery.package_type || "Standard"}</span>
                </div>
                <div className="info-row highlight">
                  <span className="label">Priority</span>
                  <span className="value" style={{ color: "var(--warning)" }}>{selectedDelivery.priority?.toUpperCase()}</span>
                </div>
              </div>
            </div>
          )}

          <div className="sidebar-section legend-section">
            <div className="sidebar-section-head">
              <h3>Map Legend</h3>
            </div>
            <div className="legend-items">
              <div className="legend-item"><span className="dot dot--pickup" /> Pickup Point</div>
              <div className="legend-item"><span className="dot dot--dest" /> Destination</div>
              <div className="legend-item"><span className="line line--planned" /> Planned Route</div>
              <div className="legend-item"><span className="dot dot--drone" /> Drone Position</div>
            </div>
          </div>
        </aside>

        <main className="map-main-premium">
          {selectedDeliveryId ? (
            <DeliveryTracker
              deliveryId={selectedDeliveryId}
              onClose={() => setSelectedDeliveryId(null)}
            />
          ) : (
            <div className="map-placeholder">
              <div className="placeholder-content">
                <div className="icon">📍</div>
                <h2>Select a delivery to track</h2>
                <p className="subtle">Use the sidebar on the left to choose an active order for real-time tracking.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

