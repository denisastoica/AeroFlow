import React, { useEffect, useState } from "react";
import api from "../services/api";
import DroneMap from "./DroneMap";
import { formatBackendDateTime } from "../utils/datetime";

export default function DeliveryDetail({ deliveryId, onClose }) {
  const [delivery, setDelivery] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      setLoading(true);
      try {
        const [d, ev] = await Promise.all([
          api.get(`/deliveries/${deliveryId}`),
          api.get(`/missions/events?delivery_id=${deliveryId}`),
        ]);
        if (mounted) {
          setDelivery(d.data);
          setEvents(ev.data || []);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    return () => { mounted = false; };
  }, [deliveryId]);

  if (loading) return <div className="card"><div className="card-body">Loading...</div></div>;
  if (!delivery) return <div className="card"><div className="card-body">This delivery does not exist.</div></div>;

    const timeline = [
    { label: "Created", key: "created_at", icon: "🆕" },
    { label: "Assigned", key: "assigned_at", icon: "🤖" },
    { label: "Pickup", key: "picked_up_at", icon: "📦" },
    { label: "In Transit", key: "in_transit_at", icon: "✈️" },
    { label: "Delivered", key: "delivered_at", icon: "✅" },
    { label: "Failed", key: "failed_at", icon: "❌" },
  ];

  return (
    <div className="delivery-detail-modal">
      <div className="delivery-detail-header">
        <h2>Delivery #{delivery.id}</h2>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="delivery-detail-main">
        <div className="delivery-detail-section">
          <div className="delivery-detail-status">
            <span className={`badge badge--${delivery.status}`}>{delivery.status}</span>
            <span className="badge badge--priority">{delivery.priority}</span>
            <span className="badge badge--pkg">{delivery.package_type} · {delivery.weight_kg} kg</span>
          </div>
          <div className="delivery-detail-row">
            <b>Assigned Drone:</b> {delivery.drone_name || "-"}
          </div>
          <div className="delivery-detail-row">
            <b>ETA:</b> {delivery.eta_min ? `${delivery.eta_min} min` : "-"}
          </div>
        </div>
        <div className="delivery-detail-section">
          <h4>Timeline</h4>
          <ul className="delivery-timeline">
            {timeline.map((t, idx) => (
              <li key={t.key} className={delivery[t.key] ? "active" : ""}>
                <span className="delivery-timeline-icon">{t.icon}</span>
                <span className="delivery-timeline-label">{t.label}</span>
                <span className="delivery-timeline-date">{delivery[t.key] ? formatBackendDateTime(delivery[t.key], { locale: "en-US", fallback: "-" }) : "-"}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="delivery-detail-section">
          <h4>Map Route</h4>
                    <div style={{ height: 220, borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
            <DroneMap deliveryId={delivery.id} highlightRoute sidebar />
          </div>
        </div>
        <div className="delivery-detail-section">
          <h4>Event History</h4>
          <ul className="delivery-events-list">
            {events.map(ev => (
              <li key={ev.id}>
                <span className="delivery-event-date">{formatBackendDateTime(ev.timestamp, { locale: "en-US" })}</span>
                <span className="delivery-event-type">{ev.event_type}</span>
                <span className="delivery-event-msg">{ev.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
