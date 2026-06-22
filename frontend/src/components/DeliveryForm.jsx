import React, { useState, useEffect, useCallback } from "react";
import { deliveriesAPI, geocodingAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../context/AuthContext";

const PRIORITY_STYLES = {
  normal: { border: "var(--border)", bg: "#1a1a2e", color: "var(--text)" },
  urgent: { border: "rgba(255,209,102,0.4)", bg: "rgba(255,209,102,0.1)", color: "#ffd166" },
  emergency: { border: "rgba(255,77,109,0.4)", bg: "rgba(255,77,109,0.1)", color: "#ff4d6d" },
};

const PACKAGE_STYLES = {
  standard: { bg: "rgba(255,255,255,0.1)", color: "#ffffff", border: "rgba(255,255,255,0.2)" },
  medical: { bg: "rgba(255,77,109,0.2)", color: "#ffffff", border: "rgba(255,77,109,0.5)" },
  fragile: { bg: "rgba(255,209,102,0.2)", color: "#ffffff", border: "rgba(255,209,102,0.5)" },
  food: { bg: "rgba(106,228,255,0.2)", color: "#ffffff", border: "rgba(106,228,255,0.5)" },
};

export default function DeliveryForm({ onDeliveryCreated }) {
  const toast = useToast();
  const { user } = useAuth();
  const [pickupLat, setPickupLat] = useState(null);
  const [pickupLon, setPickupLon] = useState(null);
  const [destLat, setDestLat] = useState(null);
  const [destLon, setDestLon] = useState(null);
  const [pickupAddress, setPickupAddress] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [pickupGeoStatus, setPickupGeoStatus] = useState("idle");
  const [destGeoStatus, setDestGeoStatus] = useState("idle");
  const [priority, setPriority] = useState("normal");
  const [packageType, setPackageType] = useState("standard");
  const [notes, setNotes] = useState("");
  const [weightKg, setWeightKg] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [estimate, setEstimate] = useState({
    distance_km: 0,
    effective_speed_kmh: 0,
    estimated_duration_h: 0,
    needs_charging: false,
    charging_stops: 0,
    is_feasible: true,
    max_feasible_km: 500,
  });

  const fetchEstimate = useCallback(async () => {
    if (!pickupLat || !pickupLon || !destLat || !destLon) return;
    setEstimating(true);
    try {
      const res = await deliveriesAPI.estimate({
        pickup_lat: parseFloat(pickupLat),
        pickup_lon: parseFloat(pickupLon),
        dest_lat: parseFloat(destLat),
        dest_lon: parseFloat(destLon),
        weight_kg: parseFloat(weightKg),
        priority,
      });
      setEstimate(res.data);
    } catch (err) {
      console.error("Estimation error:", err);
    } finally {
      setEstimating(false);
    }
  }, [pickupLat, pickupLon, destLat, destLon, weightKg, priority]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEstimate();
    }, 500);
    return () => clearTimeout(timer);
  }, [fetchEstimate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      toast.error("Your session has expired. Please sign in again.");
      return;
    }
    if (!pickupLat || !pickupLon) {
      toast.error("Please enter a valid pickup address and wait for it to be resolved.");
      return;
    }
    if (!destLat || !destLon) {
      toast.error("Please enter a valid destination address and wait for it to be resolved.");
      return;
    }
    if (!estimate.is_feasible) {
      toast.error(`Delivery is not feasible: distance (${estimate.distance_km.toFixed(1)} km) exceeds maximum range or no charging stations are available.`);
      return;
    }
    setLoading(true);
    try {
      const response = await deliveriesAPI.create({
        pickup_lat: parseFloat(pickupLat),
        pickup_lon: parseFloat(pickupLon),
        dest_lat: parseFloat(destLat),
        dest_lon: parseFloat(destLon),
        pickup_address: pickupAddress.trim() || undefined,
        dest_address: destAddress.trim() || undefined,
        priority,
        package_type: packageType,
        notes: notes || undefined,
        weight_kg: parseFloat(weightKg),
      });
      toast.success(
        `Delivery #${response.data.id} created successfully! You will receive the 6-digit confirmation code by email when the drone arrives at your destination. Est. ${response.data.estimated_distance_km?.toFixed(1) || "?"} km.`
      );
            setPickupLat(null); setPickupLon(null); setDestLat(null); setDestLon(null);
      setPickupAddress(""); setDestAddress("");
      setPickupGeoStatus("idle"); setDestGeoStatus("idle");
      setPriority("normal"); setPackageType("standard"); setNotes(""); setWeightKg(1.0);
      if (onDeliveryCreated) onDeliveryCreated(response.data);
    } catch (err) {
      toast.error(getErrorMessage(err, "Error creating delivery"));
    } finally {
      setLoading(false);
    }
  };

    useEffect(() => {
    const trimmed = pickupAddress.trim();
    if (!trimmed || trimmed.length < 3) {
      setPickupLat(null);
      setPickupLon(null);
      setPickupGeoStatus("idle");
      return;
    }

    setPickupGeoStatus("loading");

    const timer = setTimeout(async () => {
      try {
        const res = await geocodingAPI.search(trimmed);
        if (res.data.success && res.data.lat != null && res.data.lon != null) {
          setPickupLat(res.data.lat);
          setPickupLon(res.data.lon);
          setPickupGeoStatus("ok");
        } else {
          setPickupLat(null);
          setPickupLon(null);
          setPickupGeoStatus("error");
        }
      } catch (err) {
        setPickupLat(null);
        setPickupLon(null);
        setPickupGeoStatus("error");
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [pickupAddress]);

    useEffect(() => {
    const trimmed = destAddress.trim();
    if (!trimmed || trimmed.length < 3) {
      setDestLat(null);
      setDestLon(null);
      setDestGeoStatus("idle");
      return;
    }

    setDestGeoStatus("loading");

    const timer = setTimeout(async () => {
      try {
        const res = await geocodingAPI.search(trimmed);
        if (res.data.success && res.data.lat != null && res.data.lon != null) {
          setDestLat(res.data.lat);
          setDestLon(res.data.lon);
          setDestGeoStatus("ok");
        } else {
          setDestLat(null);
          setDestLon(null);
          setDestGeoStatus("error");
        }
      } catch (err) {
        setDestLat(null);
        setDestLon(null);
        setDestGeoStatus("error");
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [destAddress]);

  return (
    <div className="card theme-customer">
      <div className="card-body">
        <h3 style={{ marginTop: 0, marginBottom: 20 }}>Create New Delivery</h3>
        <form onSubmit={handleSubmit}>
                    <div className="field stack-xs">
            <label className="label">Pickup Location</label>
            <div style={{ position: "relative" }}>
              <input
                className="input"
                type="text"
                placeholder="Piața Sfatului, Brașov"
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
                style={{
                  paddingRight: 32,
                  borderColor: pickupGeoStatus === "ok" ? "var(--success)" : pickupGeoStatus === "error" ? "var(--danger)" : undefined,
                }}
              />
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none" }}>
                {pickupGeoStatus === "loading" && <span className="spinner spinner-sm" style={{ width: 12, height: 12 }} />}
                {pickupGeoStatus === "ok" && <span style={{ color: "var(--success)" }}>✓</span>}
                {pickupGeoStatus === "error" && <span style={{ color: "var(--danger)" }}>✗</span>}
              </span>
            </div>
            {pickupGeoStatus === "ok" && pickupLat && (
              <div style={{ fontSize: 11, color: "var(--success)", opacity: 0.8, marginTop: 3 }}>
                📍 {Number(pickupLat).toFixed(5)}, {Number(pickupLon).toFixed(5)}
              </div>
            )}
            {pickupGeoStatus === "error" && (
              <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>
                Address not found. Use ⚙️ to enter coordinates manually.
              </div>
            )}
            {showAdvanced && (
              <div style={{ padding: 12, background: "rgba(0,0,0,0.15)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", marginTop: 8, animation: "fadeIn 0.2s ease" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label className="label" style={{ fontSize: 11, opacity: 0.7 }}>Latitude</label>
                    <input className="input" type="number" step="0.0001" value={pickupLat ?? ""} onChange={(e) => { setPickupLat(e.target.value); setPickupGeoStatus(e.target.value ? "ok" : "idle"); }} />
                  </div>
                  <div>
                    <label className="label" style={{ fontSize: 11, opacity: 0.7 }}>Longitude</label>
                    <input className="input" type="number" step="0.0001" value={pickupLon ?? ""} onChange={(e) => { setPickupLon(e.target.value); setPickupGeoStatus(e.target.value ? "ok" : "idle"); }} />
                  </div>
                </div>
              </div>
            )}
          </div>

                    <div className="field stack-xs" style={{ marginTop: 16 }}>
            <label className="label">Delivery Destination</label>
            <div style={{ position: "relative" }}>
              <input
                className="input"
                type="text"
                placeholder="Str. Ștefan cel Mare 35, Suceava"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                style={{
                  paddingRight: 32,
                  borderColor: destGeoStatus === "ok" ? "var(--success)" : destGeoStatus === "error" ? "var(--danger)" : undefined,
                }}
              />
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none" }}>
                {destGeoStatus === "loading" && <span className="spinner spinner-sm" style={{ width: 12, height: 12 }} />}
                {destGeoStatus === "ok" && <span style={{ color: "var(--success)" }}>✓</span>}
                {destGeoStatus === "error" && <span style={{ color: "var(--danger)" }}>✗</span>}
              </span>
            </div>
            {destGeoStatus === "ok" && destLat && (
              <div style={{ fontSize: 11, color: "var(--success)", opacity: 0.8, marginTop: 3 }}>
                📍 {Number(destLat).toFixed(5)}, {Number(destLon).toFixed(5)}
              </div>
            )}
            {destGeoStatus === "error" && (
              <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>
                Address not found. Use ⚙️ to enter coordinates manually.
              </div>
            )}
            {showAdvanced && (
              <div style={{ padding: 12, background: "rgba(0,0,0,0.15)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", marginTop: 8, animation: "fadeIn 0.2s ease" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label className="label" style={{ fontSize: 11, opacity: 0.7 }}>Latitude</label>
                    <input className="input" type="number" step="0.0001" value={destLat ?? ""} onChange={(e) => { setDestLat(e.target.value); setDestGeoStatus(e.target.value ? "ok" : "idle"); }} />
                  </div>
                  <div>
                    <label className="label" style={{ fontSize: 11, opacity: 0.7 }}>Longitude</label>
                    <input className="input" type="number" step="0.0001" value={destLon ?? ""} onChange={(e) => { setDestLon(e.target.value); setDestGeoStatus(e.target.value ? "ok" : "idle"); }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, textAlign: "right" }}>
            <button 
              type="button" 
              className="btn btn-ghost" 
              style={{ fontSize: 11, padding: "4px 10px", opacity: 0.8 }}
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "✕ Hide Coordinates" : "⚙️ Edit pickup/destination coordinates"}
            </button>
          </div>

                    <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
            <div>
              <label className="label">Priority</label>
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}
                style={{ borderColor: PRIORITY_STYLES[priority].border, background: PRIORITY_STYLES[priority].bg, color: PRIORITY_STYLES[priority].color, fontWeight: 600 }}>
                <option value="normal" style={{ background: "#1a1a2e", color: "#fff" }}>Standard</option>
                <option value="urgent" style={{ background: "#1a1a2e", color: "#fff" }}>Urgent</option>
                <option value="emergency" style={{ background: "#1a1a2e", color: "#fff" }}>Medical Emergency</option>
              </select>
            </div>
            <div>
              <label className="label">Package Type</label>
              <select className="input" value={packageType} onChange={(e) => setPackageType(e.target.value)}
                style={{ borderColor: PACKAGE_STYLES[packageType].border, background: PACKAGE_STYLES[packageType].bg, color: PACKAGE_STYLES[packageType].color, fontWeight: 600 }}>
                <option value="standard" style={{ background: "#1a1a2e", color: "#fff" }}>Standard</option>
                <option value="medical" style={{ background: "#1a1a2e", color: "#fff" }}>Medical</option>
                <option value="fragile" style={{ background: "#1a1a2e", color: "#fff" }}>Fragile</option>
                <option value="food" style={{ background: "#1a1a2e", color: "#fff" }}>Food</option>
              </select>
            </div>
          </div>

                    <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginTop: 16 }}>
            <div>
              <label className="label">Weight (kg)</label>
              <input className="input" type="number" step="0.1" min="0.1" max="3" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Max: 3 kg</div>
            </div>
            <div>
              <label className="label">Notes / Instructions</label>
              <input className="input" type="text" placeholder="e.g. 2nd floor, leave at reception" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

                    {priority === "emergency" && (
            <div className="alert fade-in" style={{ background: "rgba(255,77,109,0.1)", color: "#ff4d6d", border: "1px solid rgba(255,77,109,0.2)", marginTop: 12 }}>
              MEDICAL EMERGENCY — Drone with maximum battery will be assigned with absolute priority.
            </div>
          )}
          {priority === "urgent" && (
            <div className="alert fade-in" style={{ background: "rgba(255,209,102,0.1)", color: "#ffd166", border: "1px solid rgba(255,209,102,0.2)", marginTop: 12 }}>
              Urgent Delivery — Increased priority for assignment and fast processing.
            </div>
          )}

                    {pickupLat && pickupLon && destLat && destLon ? (
            <div className="alert" style={{
              background: !estimate.is_feasible ? "rgba(255,77,109,0.10)" : estimate.needs_charging ? "rgba(255,209,102,0.1)" : "rgba(106,228,255,0.08)",
              borderColor: !estimate.is_feasible ? "rgba(255,77,109,0.4)" : estimate.needs_charging ? "rgba(255,209,102,0.3)" : "rgba(106,228,255,0.25)",
              color: !estimate.is_feasible ? "#ff6b8a" : estimate.needs_charging ? "#ffd166" : "var(--accent)",
              borderLeft: `4px solid ${!estimate.is_feasible ? "#ff6b8a" : estimate.needs_charging ? "#ffd166" : "var(--accent)"}`,
              position: "relative",
              marginTop: 16
            }}>
              {estimating && <div className="spinner spinner-sm" style={{ position: "absolute", top: 8, right: 8 }} />}
              <strong>Distance:</strong> {estimate.distance_km.toFixed(1)} km{" "}
              {!estimate.is_feasible ? "✘" : estimate.needs_charging ? "⚠" : "✓"}
              {!estimate.is_feasible && (
                estimate.distance_km > estimate.max_feasible_km
                  ? ` (Max ~${estimate.max_feasible_km} km)`
                  : ` (No charging station path for this route)`
              )}
              <br />
              <strong>Effective speed:</strong> {estimate.effective_speed_kmh.toFixed(0)} km/h
              {parseFloat(weightKg) > 3.5 && <span style={{ opacity: 0.7, fontSize: 12 }}> (weight penalty)</span>}
              <br />
              <strong>Estimated duration:</strong> {estimate.estimated_duration_h < 1
                ? `${Math.round(estimate.estimated_duration_h * 60)} min`
                : `${estimate.estimated_duration_h.toFixed(1)} h`}
              {estimate.needs_charging && estimate.is_feasible && (
                <>
                  <br />
                  <strong>Charging required:</strong> ~{estimate.charging_stops} {estimate.charging_stops === 1 ? "stop" : "stops"} (15 min/stop)
                </>
              )}
            </div>
          ) : (
            <div className="alert" style={{
              background: "rgba(255,255,255,0.04)",
              borderColor: "rgba(255,255,255,0.1)",
              color: "var(--muted2)",
              borderLeft: "4px solid rgba(255,255,255,0.15)",
              marginTop: 16,
              fontSize: 13,
              fontStyle: "italic",
            }}>
              Add valid pickup and destination addresses to calculate distance and ETA.
            </div>
          )}

                    {(!pickupLat || !destLat) && (pickupAddress || destAddress) && (
            <div style={{ fontSize: 12, color: "var(--muted2)", marginTop: 12, textAlign: "center" }}>
              ⬆️ Enter both addresses to resolve coordinates in real-time
            </div>
          )}
          <button
            className={`btn ${loading || !estimate.is_feasible || !pickupLat || !destLat ? "" : "btn-primary"}`}
            type="submit"
            disabled={loading || !estimate.is_feasible || estimating || !pickupLat || !destLat}
            style={{
              width: "100%",
              marginTop: 18,
              position: "relative",
              ...(priority === "emergency" && !loading && estimate.is_feasible && pickupLat && destLat ? { background: "linear-gradient(135deg, rgba(255,77,109,0.9), rgba(220,53,69,0.95))", color: "#fff", borderColor: "rgba(255,77,109,0.5)" } : {}),
              ...(priority === "urgent" && !loading && estimate.is_feasible && pickupLat && destLat ? { background: "linear-gradient(135deg, rgba(255,209,102,0.9), rgba(255,193,7,0.95))", color: "#1a1a2e", borderColor: "rgba(255,209,102,0.5)" } : {}),
            }}
            title={
              !pickupLat ? "Resolve pickup address first" :
              !destLat ? "Resolve destination address first" :
              !estimate.is_feasible ? (estimate.distance_km > estimate.max_feasible_km ? `Maximum distance is ${estimate.max_feasible_km} km with charging stations.` : `No charging station chain available for this route. Try a shorter route or choose different locations.`) :
              undefined
            }
          >
            {loading ? (<><span className="spinner spinner-sm" /> Sending...</>) : "Send Delivery Order"}
          </button>
        </form>
      </div>
    </div>
  );
}
