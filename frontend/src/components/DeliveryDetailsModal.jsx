import React, { useEffect, useState } from "react";
import { deliveriesAPI, geocodingAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { Skeleton } from "./Skeleton";
import { FALLBACK_PROOF_PHOTO_URL, resolveProofPhotoUrl } from "../utils/proofPhoto";
import { formatBackendDateTime } from "../utils/datetime";

const statusMeta = {
  pending: { label: "Pending", tone: "warning" },
  assigned: { label: "Assigned", tone: "info" },
  picking_up: { label: "Picking Up", tone: "info" },
  picked_up: { label: "Picked Up", tone: "info" },
  in_transit: { label: "In Transit", tone: "info" },
  in_progress: { label: "In Flight", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export default function DeliveryDetailsModal({ deliveryId, onClose, onConfirm, onViewProof }) {
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolvedAddresses, setResolvedAddresses] = useState({ pickup: null, destination: null });
  const [imageBroken, setImageBroken] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!deliveryId) return;
    setLoading(true);
    deliveriesAPI.getById(deliveryId)
      .then((res) => setDelivery(res.data))
      .catch((err) => toast.error(getErrorMessage(err, "Could not load delivery details")))
      .finally(() => setLoading(false));
  }, [deliveryId, toast]);

  useEffect(() => {
    setImageBroken(false);
  }, [deliveryId]);

  useEffect(() => {
    if (!delivery) {
      setResolvedAddresses({ pickup: null, destination: null });
      return undefined;
    }

    if (delivery.pickup_address && delivery.dest_address) {
      setResolvedAddresses({ pickup: delivery.pickup_address, destination: delivery.dest_address });
      return undefined;
    }

    let cancelled = false;

    const fetchAddresses = async () => {
      const [pickup, destination] = await Promise.all([
        delivery.pickup_address ? Promise.resolve(delivery.pickup_address) : reverseLookup(delivery.pickup_lat, delivery.pickup_lon),
        delivery.dest_address ? Promise.resolve(delivery.dest_address) : reverseLookup(delivery.dest_lat, delivery.dest_lon),
      ]);

      if (!cancelled) {
        setResolvedAddresses({ pickup, destination });
      }
    };

    fetchAddresses();

    return () => {
      cancelled = true;
    };
  }, [delivery]);

  if (!deliveryId) return null;

  const isDelivered = delivery?.status === "delivered";
  const isConfirmed = !!delivery?.confirmed_at;
  const status = statusMeta[delivery?.status] || { label: (delivery?.status || "Unknown").replace(/_/g, " "), tone: "muted" };
  const detailPhotoUrl = delivery?.delivery_photo_url ? resolveProofPhotoUrl(delivery.delivery_photo_url) : null;
  const detailDisplayPhotoUrl = imageBroken ? FALLBACK_PROOF_PHOTO_URL : detailPhotoUrl;

  return (
    <div className="modal-overlay app-modal-overlay" style={{ zIndex: 3200 }} onClick={onClose}>
      <div className="modal-content app-modal app-modal--details" onClick={(event) => event.stopPropagation()} aria-label="Delivery Details modal">
        <div className="app-modal__header">
          <div className="app-modal__header-stack">
            <div className="app-modal__header-row app-modal__header-row--details">
              <h2 className="app-modal__title">Order #{deliveryId}</h2>
              <span className={`app-drawer__status app-drawer__status--${status.tone}`}>{status.label}</span>
            </div>
            <p className="app-modal__subtitle">Full order summary, confirmation status, and next-step actions.</p>
          </div>
          <button className="app-modal__close" onClick={onClose} aria-label="Close delivery details modal">&times;</button>
        </div>

        <div className="app-modal__body app-modal__body--details">
          {loading ? (
            <Skeleton count={5} height={42} style={{ marginBottom: 12 }} />
          ) : delivery ? (
            <div className="app-drawer__stack">
              {(isDelivered || isConfirmed) && (
                <div className="app-modal__section-card">
                  <div className="app-drawer__section-title">Confirmation</div>
                  {isDelivered && !isConfirmed ? (
                    <div className="app-drawer__code-card app-drawer__code-card--embedded">
                      <div className="app-modal__section-label">Email Confirmation</div>
                      <div className="app-modal__section-value">A 6-digit confirmation code was sent to your email when the delivery was assigned.</div>
                      <div className="app-drawer__code-help">Use the code from your inbox in the Confirm Receipt form.</div>
                    </div>
                  ) : (
                    <>
                      <div className="app-modal__stats-grid">
                        <DetailItem label="Confirmed By" value={delivery.recipient_name || "Unavailable"} />
                        <DetailItem label="Confirmed At" value={formatDateTime(delivery.confirmed_at)} />
                      </div>
                      {delivery.delivery_notes && (
                        <div className="app-drawer__note">
                          <div className="app-modal__section-label">Confirmation Notes</div>
                          <div className="app-modal__section-value">{delivery.delivery_notes}</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="app-modal__section-card">
                <div className="app-drawer__section-title">Delivery Info</div>
                <div className="app-modal__stats-grid">
                  <DetailItem
                    label="Pickup"
                    value={resolvedAddresses.pickup || formatCoordinates(delivery.pickup_lat, delivery.pickup_lon)}
                    helper={resolvedAddresses.pickup ? formatCoordinates(delivery.pickup_lat, delivery.pickup_lon) : "Coordinates"}
                  />
                  <DetailItem
                    label="Destination"
                    value={resolvedAddresses.destination || formatCoordinates(delivery.dest_lat, delivery.dest_lon)}
                    helper={resolvedAddresses.destination ? formatCoordinates(delivery.dest_lat, delivery.dest_lon) : "Coordinates"}
                  />
                  <DetailItem label="Priority" value={capitalize(delivery.priority || "normal")} />
                  <DetailItem label="Package Type" value={capitalize(delivery.package_type || "standard")} />
                  <DetailItem label="Weight" value={delivery.weight_kg ? `${delivery.weight_kg} kg` : "Unavailable"} />
                  <DetailItem label="Assigned Drone" value={delivery.drone_id ? (delivery.drone_name || `Drone #${delivery.drone_id}`) : "Not assigned"} />
                </div>
                {delivery.notes && (
                  <div className="app-drawer__note">
                    <div className="app-modal__section-label">Notes</div>
                    <div className="app-modal__section-value">{delivery.notes}</div>
                  </div>
                )}
              </div>

              <div className="app-modal__section-card">
                <div className="app-drawer__section-title">Timing & Status</div>
                <div className="app-modal__stats-grid">
                  <DetailItem label="Status" value={status.label} accent={status.tone} />
                  <DetailItem label="Created At" value={formatDateTime(delivery.created_at)} />
                  {(() => {
                    const hasArrived = Boolean(delivery.completed_at) || ["delivered", "confirmed", "completed"].includes(delivery.status);
                    return (
                      <>
                        <DetailItem
                          label={hasArrived ? "Completed At" : "ETA"}
                          value={
                            delivery.completed_at 
                              ? formatDateTime(delivery.completed_at) 
                              : hasArrived 
                                ? "Completed" 
                                : formatEta(delivery.estimated_duration_h)
                          }
                        />
                        <DetailItem label="Arrived" value={hasArrived ? "Yes" : "Not yet"} />
                      </>
                    );
                  })()}
                </div>
              </div>

              {delivery.failure_reason && (
                <div className="app-modal__section-card app-drawer__section-card--danger">
                  <div className="app-drawer__section-title">Failure Reason</div>
                  <div className="app-modal__section-value">{delivery.failure_reason}</div>
                </div>
              )}

              {delivery.dropoff_safety_status && (
                <div className="app-modal__section-card" style={{ borderLeft: delivery.dropoff_safety_status === "passed" ? "3px solid var(--success)" : "3px solid var(--danger)" }}>
                  <div className="app-drawer__section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>🛡️ Drop-off Safety Validation</span>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      background: delivery.dropoff_safety_status === "passed" ? "rgba(51,214,159,0.15)" : "rgba(255,77,109,0.15)",
                      color: delivery.dropoff_safety_status === "passed" ? "#33d69f" : "#ff4d6d"
                    }}>
                      {delivery.dropoff_safety_status === "passed" ? "Passed" : "Blocked / Failed"}
                    </span>
                  </div>
                  <div className="app-modal__stats-grid" style={{ marginTop: 8 }}>
                    <DetailItem 
                      label="☁️ Destination Weather" 
                      value={
                        delivery.dropoff_weather_safe === "safe"
                          ? "Safe"
                          : delivery.dropoff_weather_safe === "warning"
                            ? "Caution (At Risk)"
                            : "Dangerous"
                      } 
                      accent={
                        delivery.dropoff_weather_safe === "safe"
                          ? "success"
                          : delivery.dropoff_weather_safe === "warning"
                            ? "warning"
                            : "danger"
                      }
                    />
                    <DetailItem 
                      label="🔋 Battery at Arrival" 
                      value={delivery.dropoff_battery_pct != null ? `${delivery.dropoff_battery_pct.toFixed(0)}%` : "N/A"} 
                      accent={delivery.dropoff_battery_pct >= 12.0 ? "success" : "danger"}
                    />
                    <DetailItem 
                      label="📍 Distance Offset" 
                      value={delivery.dropoff_distance_m != null ? `${delivery.dropoff_distance_m.toFixed(0)} m` : "N/A"} 
                      accent={delivery.dropoff_distance_m <= 100.0 ? "success" : "danger"}
                    />
                    <DetailItem 
                      label="🔑 Confirmation Code" 
                      value={delivery.dropoff_code_required === "Yes" ? "Required" : "Optional"} 
                    />
                  </div>
                  {(() => {
                    const isPassed = delivery.dropoff_safety_status === "passed";
                    const weather = delivery.dropoff_weather_safe;
                    if (isPassed && weather === "safe") {
                      return (
                        <div style={{ marginTop: 10, fontSize: 12, color: "var(--success)", fontWeight: 700 }}>
                          ✓ Safe drop-off conditions verified.
                        </div>
                      );
                    } else if (isPassed && weather === "warning") {
                      return (
                        <div style={{ marginTop: 10, fontSize: 12, color: "var(--warning)", fontWeight: 700 }}>
                          ⚠️ Warning: drop-off completed under at-risk weather conditions.
                        </div>
                      );
                    } else if (!isPassed) {
                      return (
                        <div style={{ marginTop: 10, fontSize: 12, color: "var(--danger)", fontWeight: 700 }}>
                          ⚠️ Safety check blocked: {delivery.dropoff_safety_reason || "weather unsafe"}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              {isConfirmed && detailDisplayPhotoUrl && (
                <div className="app-modal__section-card">
                  <div className="app-drawer__section-title">Proof Status</div>
                  <div className="app-drawer__note">
                    <div className="app-modal__section-label">Photo</div>
                    <div className="app-modal__photo-wrap">
                      <img
                        src={detailDisplayPhotoUrl}
                        alt="Delivery proof"
                        className="app-modal__photo"
                        onError={(event) => {
                          setImageBroken(true);
                          event.currentTarget.src = FALLBACK_PROOF_PHOTO_URL;
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="subtle" style={{ textAlign: "center", padding: 24 }}>
              Delivery details not available.
            </div>
          )}
        </div>

        <div className="app-modal__footer">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
          {!loading && delivery && isConfirmed && onViewProof && (
            <button className="btn btn-outline" onClick={() => onViewProof?.(delivery.id)}>
              View Proof
            </button>
          )}
          {!loading && delivery && isDelivered && !isConfirmed && onConfirm && (
            <button className="btn btn--primary" onClick={() => onConfirm?.(delivery.id)}>
              Confirm Delivery
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value, accent, helper }) {
  const valueClassName = accent ? `app-modal__proof-value app-modal__proof-value--${accent}` : "app-modal__section-value";
  return (
    <div className="app-modal__proof-card">
      <div className="app-modal__section-label">{label}</div>
      <div className={valueClassName}>{value}</div>
      {helper && <div className="app-modal__field-help">{helper}</div>}
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "Unavailable";
  return formatBackendDateTime(value, { locale: "en-US" });
}

function formatCoordinates(lat, lon) {
  if (lat == null || lon == null) return "Unavailable";
  return `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
}

function formatEta(durationHours) {
  if (!durationHours) return "Unavailable";
  if (durationHours < 1) return `${Math.round(durationHours * 60)} min`;
  return `${durationHours.toFixed(1)} h`;
}

function capitalize(value) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

async function reverseLookup(lat, lon) {
  if (lat == null || lon == null) return null;
  try {
    const response = await geocodingAPI.reverse(lat, lon);
    return response.data?.success ? response.data.address : null;
  } catch {
    return null;
  }
}