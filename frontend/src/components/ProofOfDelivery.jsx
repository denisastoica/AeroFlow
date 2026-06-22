import React, { useState, useEffect } from "react";
import { proofOfDeliveryAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { Skeleton } from "./Skeleton";
import { FALLBACK_PROOF_PHOTO_URL, resolveProofPhotoUrl } from "../utils/proofPhoto";
import { formatBackendDateTime } from "../utils/datetime";

export default function ProofOfDelivery({ deliveryId, onClose }) {
  const [proof, setProof] = useState(null);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    if (!deliveryId) return;
    setLoading(true);
    setImageBroken(false);
    proofOfDeliveryAPI.getProof(deliveryId)
      .then(res => setProof(res.data))
      .catch(err => addToast(getErrorMessage(err, "Could not load proof of delivery"), "error"))
      .finally(() => setLoading(false));
  }, [deliveryId, addToast]);

  if (!deliveryId) return null;

  const photoUrl = proof?.delivery_photo_url ? resolveProofPhotoUrl(proof.delivery_photo_url) : null;
  const displayPhotoUrl = imageBroken ? FALLBACK_PROOF_PHOTO_URL : photoUrl;

  return (
    <div className="modal-overlay app-modal-overlay" style={{ zIndex: 3000 }} onClick={onClose}>
      <div className="modal-content app-modal app-modal--proof" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="app-modal__header">
          <div>
            <h2 className="app-modal__title">Proof of Delivery</h2>
            <p className="app-modal__subtitle">Order ID #{deliveryId}</p>
          </div>
          <button className="app-modal__close" onClick={onClose} aria-label="Close proof of delivery modal">&times;</button>
        </div>

        <div className="app-modal__body">
          {loading ? (
            <div>
              <Skeleton count={5} height={40} style={{ marginBottom: 12 }} />
            </div>
          ) : proof ? (
            <div className="pod-details">
              <div className="app-modal__stats-grid app-modal__stats-grid--proof">
                <ProofField label="Status" value={proof.confirmed_at ? "Confirmed" : "Awaiting confirmation"} accent={proof.confirmed_at ? "success" : "warning"} />
                <ProofField label="Completed At" value={proof.completed_at ? formatBackendDateTime(proof.completed_at, { locale: "en-US" }) : "Unavailable"} />
                <ProofField label="Confirmed By" value={proof.recipient_name || "Not confirmed yet"} />
                <ProofField label="Confirmation Time" value={proof.confirmed_at ? formatBackendDateTime(proof.confirmed_at, { locale: "en-US" }) : "Pending"} />
              </div>

              {proof.dropoff_safety_status && (
                <div className="app-modal__section-card" style={{ marginTop: 16 }}>
                  <div className="app-modal__section-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>🛡️ Drop-off Safety</span>
                    <span style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      background: proof.dropoff_safety_status === "passed" ? "rgba(51,214,159,0.15)" : "rgba(255,77,109,0.15)",
                      color: proof.dropoff_safety_status === "passed" ? "#33d69f" : "#ff4d6d"
                    }}>
                      {proof.dropoff_safety_status === "passed" ? "Passed" : "Failed / Held"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginTop: 8, fontSize: 13 }}>
                    <div>☁️ Weather: <strong style={{
                      color: proof.dropoff_weather_safe === "safe"
                        ? "var(--success)"
                        : proof.dropoff_weather_safe === "warning"
                          ? "var(--warning)"
                          : "var(--danger)"
                    }}>
                      {proof.dropoff_weather_safe === "safe"
                        ? "Safe"
                        : proof.dropoff_weather_safe === "warning"
                          ? "Caution (At Risk)"
                          : "Dangerous"
                      }
                    </strong></div>
                    <div>🔋 Battery: <strong>{proof.dropoff_battery_pct != null ? `${proof.dropoff_battery_pct.toFixed(0)}%` : "N/A"}</strong></div>
                    <div>📍 Distance offset: <strong>{proof.dropoff_distance_m != null ? `${proof.dropoff_distance_m.toFixed(0)} m` : "N/A"}</strong></div>
                    <div>🔑 Confirmation code: <strong>{proof.dropoff_code_required === "Yes" ? "Required" : "Optional"}</strong></div>
                  </div>
                  {(() => {
                    const isPassed = proof.dropoff_safety_status === "passed";
                    const weather = proof.dropoff_weather_safe;
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
                          ⚠️ Safety check blocked: {proof.dropoff_safety_reason || "weather unsafe"}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              <div className="app-modal__section-card">
                <div className="app-modal__section-label">Notes</div>
                <div className="app-modal__section-value">
                  {proof.delivery_notes || "No delivery notes attached."}
                </div>
              </div>

              <div className="app-modal__section-card app-modal__proof-media-card">
                <div className="app-modal__proof-media-head">
                  <div className="app-modal__proof-media-title-row">
                    <div className="app-modal__section-label">Photo Proof</div>
                    <div className={`app-modal__proof-media-status ${photoUrl ? "app-modal__proof-media-status--attached" : "app-modal__proof-media-status--empty"}`}>
                      {photoUrl ? "Attached" : "Not attached"}
                    </div>
                  </div>
                </div>

                {displayPhotoUrl ? (
                  <div className="app-modal__proof-media-row">
                    <button
                      type="button"
                      className="app-modal__proof-thumb-button"
                      onClick={() => setPreviewOpen(true)}
                      aria-label="Preview proof photo"
                    >
                      <img
                        src={displayPhotoUrl}
                        alt="Proof of Delivery"
                        className="app-modal__proof-thumb"
                        onError={(e) => {
                          setImageBroken(true);
                          e.currentTarget.src = FALLBACK_PROOF_PHOTO_URL;
                        }}
                      />
                    </button>

                    <div className="app-modal__proof-media-copy">
                      <div className="app-modal__section-value">Photo proof attached</div>
                      <div className="app-modal__photo-placeholder-help">Click the thumbnail or use the button below to preview it larger.</div>
                      <button type="button" className="btn btn-outline" onClick={() => setPreviewOpen(true)}>
                        View Photo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="app-modal__proof-media-row app-modal__proof-media-row--empty">
                    <div className="app-modal__photo-placeholder-icon" aria-hidden="true">🖼</div>
                    <div className="app-modal__proof-media-copy">
                      <div className="app-modal__section-value">No photo proof attached</div>
                      <div className="app-modal__photo-placeholder-help">No photo available for this delivery.</div>
                    </div>
                  </div>
                )}
              </div>

              {!proof.confirmed_at && (
                <div className="app-modal__section-card">
                  <div className="app-modal__section-label">Confirmation Pending</div>
                  <div className="app-modal__section-value">The 6-digit confirmation code is sent by email when the delivery is assigned and is required to complete this delivery.</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: 24, textAlign: "center" }} className="subtle">
              Proof of delivery not found.
            </div>
          )}
        </div>

        <div className="app-modal__footer">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>

      {previewOpen && displayPhotoUrl && (
        <div className="modal-overlay app-modal-overlay" style={{ zIndex: 3100 }} onClick={() => setPreviewOpen(false)}>
          <div className="modal-content app-modal app-modal--photo-preview" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal__header">
              <div>
                <h2 className="app-modal__title">Photo Preview</h2>
                <p className="app-modal__subtitle">Order ID #{deliveryId}</p>
              </div>
              <button className="app-modal__close" onClick={() => setPreviewOpen(false)} aria-label="Close photo preview">&times;</button>
            </div>

            <div className="app-modal__body app-modal__body--photo-preview">
              <div className="app-modal__photo-preview-wrap">
                <img
                  src={displayPhotoUrl}
                  alt="Proof of Delivery Preview"
                  className="app-modal__photo-preview"
                  onError={(e) => {
                    setImageBroken(true);
                    e.currentTarget.src = FALLBACK_PROOF_PHOTO_URL;
                  }}
                />
              </div>
            </div>

            <div className="app-modal__footer">
              <button className="btn btn-outline" onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProofField({ label, value, accent }) {
  const className = accent ? `app-modal__proof-value app-modal__proof-value--${accent}` : "app-modal__proof-value";
  return (
    <div className="app-modal__proof-card">
      <div className="app-modal__section-label">{label}</div>
      <div className={className}>{value}</div>
    </div>
  );
}
