import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { deliveriesAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { Skeleton } from "./Skeleton";
import ProofOfDelivery from "./ProofOfDelivery";
import DeliveryDiagnostics from "./DeliveryDiagnostics";
import DeliveryDetailsModal from "./DeliveryDetailsModal";
import DeliveryTracker from "./DeliveryTracker";
import { formatBackendDate, formatBackendTime } from "../utils/datetime";

const statusColors = {
  pending: "#ffd166",
  assigned: "#6ae4ff",
  picking_up: "#a78bfa",
  picked_up: "#7c5cff",
  in_transit: "#38bdf8",
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
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Failed",
};

export default function DeliveryHistory() {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [selectedPoD, setSelectedPoD] = useState(null);
  const [selectedDiag, setSelectedDiag] = useState(null);
  const [selectedDetails, setSelectedDetails] = useState(null);
  const [selectedTracker, setSelectedTracker] = useState(null);
  
  const [filters, setFilters] = useState({
    search_id: "",
    drone_id: "",
    status: "",
    priority: "",
    date_from: "",
    date_to: "",
    order_type: "real",
  });

  const location = useLocation();
  const locationStateProcessed = useRef(false);

  useEffect(() => {
    if (!locationStateProcessed.current && location.state?.droneId) {
      setFilters(prev => ({ ...prev, drone_id: location.state.droneId }));
      locationStateProcessed.current = true;
    }
  }, [location.state]);

  const toast = useToast();

  const fetchDeliveries = useCallback(async () => {
    setLoading(true);
    try {
      const searchFilters = {
        search_id: filters.search_id ? parseInt(filters.search_id) : null,
        drone_id: filters.drone_id ? parseInt(filters.drone_id) : null,
        status: filters.status ? [filters.status] : null,
        priority: filters.priority ? [filters.priority] : null,
        date_from: filters.date_from ? new Date(filters.date_from).toISOString() : null,
        date_to: filters.date_to ? new Date(filters.date_to).toISOString() : null,
        order_type: filters.order_type,
      };

      const response = await deliveriesAPI.search(searchFilters, {
        page,
        page_size: pageSize,
        sort_by: "created_at",
        sort_order: "desc"
      });

      setDeliveries(response.data.items);
      setTotal(response.data.total);
    } catch (err) {
      toast.error(getErrorMessage(err, "Error loading history"));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters, toast]);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({
      search_id: "",
      drone_id: "",
      status: "",
      priority: "",
      date_from: "",
      date_to: "",
      order_type: "real",
    });
    setPage(1);
  };

  const totalPages = Math.ceil(total / pageSize);

  const renderActions = (delivery) => {
    const isPending = delivery.status === "pending";
    const isActive = ["assigned", "picking_up", "picked_up", "in_transit", "in_progress"].includes(delivery.status);
    const isDelivered = ["delivered", "confirmed"].includes(delivery.status);
    const isTerminalFailure = ["failed", "cancelled"].includes(delivery.status);

    return (
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          className="btn btn--icon"
          onClick={() => setSelectedDetails(delivery.id)}
          aria-label="Details"
          title="View Delivery Details"
        >
          🔎
        </button>

        {isPending && (
          <button
            className="btn btn--icon"
            onClick={() => setSelectedDiag({ id: delivery.id, mode: "assignment" })}
            aria-label="Assignment Diagnostics"
            title="View Assignment Diagnostics"
            style={{ color: "#ffb347" }}
          >
            🔬
          </button>
        )}

        {isActive && (
          <button
            className="btn btn--icon"
            onClick={() => setSelectedTracker(delivery.id)}
            aria-label="Track / Mission"
            title="Track Mission"
            style={{ color: "#6ae4ff" }}
          >
            📡
          </button>
        )}

        {isDelivered && (
          <button
            className="btn btn--icon"
            onClick={() => setSelectedPoD(delivery.id)}
            aria-label="Proof of Delivery"
            title="View Proof of Delivery"
            style={{ color: "#33d69f" }}
          >
            📷
          </button>
        )}

        {isTerminalFailure && (
          <button
            className="btn btn--icon"
            onClick={() => setSelectedDiag({ id: delivery.id, mode: "failure" })}
            aria-label="Failure Diagnostics"
            title="View Failure Diagnostics"
            style={{ color: "#ff9f43" }}
          >
            ⚠️
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="stack theme-dispatcher">
      <header className="page-header">
        <div>
          <h1>Delivery History</h1>
          <p className="subtle">Search deliveries, review statuses, and inspect mission diagnostics.</p>
        </div>
      </header>

      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <div className="form-group">
            <label>Order ID</label>
            <input 
              type="text" 
              name="search_id"
              value={filters.search_id}
              onChange={handleFilterChange}
              placeholder="e.g. 101"
              style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#fff" }}
            />
          </div>

          <div className="form-group">
            <label>Drone ID</label>
            <input 
              type="text" 
              name="drone_id"
              value={filters.drone_id}
              onChange={handleFilterChange}
              placeholder="e.g. 2"
              style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#fff" }}
            />
          </div>

          <div className="form-group">
            <label>Delivery Status</label>
            <select 
              name="status"
              className="select-input" 
              value={filters.status}
              onChange={handleFilterChange}
              style={{ width: "100%" }}
            >
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Priority</label>
            <select 
              name="priority"
              className="select-input" 
              value={filters.priority}
              onChange={handleFilterChange}
              style={{ width: "100%" }}
            >
              <option value="">All Priorities</option>
              <option value="normal">Standard</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Medical Emergency</option>
            </select>
          </div>

          <div className="form-group">
            <label>Order Type</label>
            <select 
              name="order_type"
              className="select-input" 
              value={filters.order_type}
              onChange={handleFilterChange}
              style={{ width: "100%" }}
            >
              <option value="real">Real Only</option>
              <option value="demo">Demo Only</option>
              <option value="all">All Orders</option>
            </select>
          </div>

          <div className="form-group">
            <label>From Date</label>
            <input 
              type="date" 
              name="date_from"
              value={filters.date_from}
              onChange={handleFilterChange}
              style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#fff" }}
            />
          </div>

          <div className="form-group">
            <label>To Date</label>
            <input 
              type="date" 
              name="date_to"
              value={filters.date_to}
              onChange={handleFilterChange}
              style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#fff" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16 }}>
          <button className="btn" onClick={handleClearFilters}>Clear Filters</button>
          <button className="btn btn--primary" onClick={fetchDeliveries}>🔍 Search Deliveries</button>
        </div>
      </div>

      {loading ? (
        <Skeleton count={8} height={60} style={{ marginBottom: 12 }} />
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Package</th>
                  <th>Status</th>
                  <th>Drone</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 800 }}>#{d.id}</td>
                    <td className="subtle">
                      <div style={{ fontWeight: 600 }}>{formatBackendTime(d.created_at, { locale: "en-US", options: { hour: "2-digit", minute: "2-digit" } })}</div>
                      <div style={{ fontSize: 11 }}>{formatBackendDate(d.created_at, { locale: "en-US" })}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: "6px" }}>
                        {d.customer_name || `User #${d.customer_id}`}
                        {d.customer_name?.includes("Demo") && (
                          <span className="badge" style={{ background: "rgba(167, 139, 250, 0.15)", color: "#a78bfa", borderColor: "rgba(167, 139, 250, 0.3)", fontSize: "9px", padding: "2px 6px" }}>
                            DEMO
                          </span>
                        )}
                      </div>
                      <div className="subtle" style={{ fontSize: 11 }}>Customer</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{d.package_type || "standard"}</div>
                      <div className="subtle" style={{ fontSize: 11 }}>{d.weight_kg} kg</div>
                    </td>
                    <td>
                      <span className="badge" style={{ 
                        borderColor: `${statusColors[d.status]}44`, 
                        background: `${statusColors[d.status]}15`,
                        color: statusColors[d.status],
                        fontSize: 10,
                        fontWeight: 700
                      }}>
                        {statusLabels[d.status]?.toUpperCase() || d.status}
                      </span>
                    </td>
                    <td>
                      {d.drone_id ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>{d.drone_name || `Drone #${d.drone_id}`}</div>
                          <div className="subtle" style={{ fontSize: 11 }}>DR-{d.drone_id.toString().padStart(2, '0')} • AeroFlow X1</div>
                        </div>
                      ) : (
                        <span className="subtle" style={{ fontStyle: "italic" }}>Unassigned</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", paddingRight: 16 }}>
                      {renderActions(d)}
                    </td>
                  </tr>
                ))}
                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: 60 }} className="subtle">
                      <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
                      No deliveries found matching the search criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 24, alignItems: "center" }}>
              <button 
                className="btn btn--icon" 
                disabled={page <= 1} 
                onClick={() => setPage(p => p - 1)}
              >
                ⬅️
              </button>
              <span className="subtle">Page <strong>{page}</strong> of {totalPages}</span>
              <button 
                className="btn btn--icon" 
                disabled={page >= totalPages} 
                onClick={() => setPage(p => p + 1)}
              >
                ➡️
              </button>
            </div>
          )}
        </>
      )}

      {selectedPoD && <ProofOfDelivery deliveryId={selectedPoD} onClose={() => setSelectedPoD(null)} />}
      {selectedDiag && (
        <DeliveryDiagnostics
          deliveryId={selectedDiag.id}
          mode={selectedDiag.mode}
          onClose={() => setSelectedDiag(null)}
        />
      )}
      {selectedDetails && (
        <DeliveryDetailsModal
          deliveryId={selectedDetails}
          onClose={() => setSelectedDetails(null)}
        />
      )}
      {selectedTracker && (
        <div className="modal-overlay app-modal-overlay" style={{ zIndex: 3400 }} onClick={() => setSelectedTracker(null)}>
          <div
            className="modal-content app-modal app-modal--tracker-shell"
            style={{ maxWidth: 1220 }}
            onClick={(event) => event.stopPropagation()}
            aria-label="Delivery tracker modal"
          >
            <div className="app-modal__body app-modal__body--tracker-shell">
              <DeliveryTracker deliveryId={selectedTracker} onClose={() => setSelectedTracker(null)} />
            </div>
          </div>
        </div>
      )}

      <style>{`
        .delivery-history .form-group label {
          display: block;
          margin-bottom: 6px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: rgba(255,255,255,0.5);
        }

        .app-modal--tracker-shell {
          width: min(100%, 1220px);
          max-height: min(94vh, 980px);
          overflow: hidden;
        }

        .app-modal__body--tracker-shell {
          padding: 0;
        }
      `}</style>
    </div>
  );
}
