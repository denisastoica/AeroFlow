import React, { useState } from "react";
import api, { getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { Shield, Plus, Trash2, X, MapPin } from "lucide-react";

export default function NoFlyZoneManager({ 
  zones = [], 
  onRefresh, 
  showOverlay, 
  onToggleOverlay, 
  mapInstance 
}) {
  const toast = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    reason: "",
    radius_km: 1.0,
    zone_type: "temporary"
  });

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await api.delete(`/no-fly-zones/${id}`);
      toast.success("Restricted zone removed.");
      onRefresh();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to remove zone"));
    }
  };

  const handleAdd = async () => {
    if (!formData.name) return toast.error("Zone name is required.");
    if (!addressQuery.trim()) return toast.error("Address is required.");
    
    setLoading(true);
    try {
      let center_lat, center_lon;

      const geoRes = await api.get(`/geocoding/search?q=${encodeURIComponent(addressQuery.trim())}`);
      if (geoRes.data && geoRes.data.success) {
        center_lat = geoRes.data.lat;
        center_lon = geoRes.data.lon;
        if (mapInstance) {
          mapInstance.flyTo([center_lat, center_lon], 14, { animate: true });
        }
      } else {
        toast.error(geoRes.data.error || "Address not found.");
        setLoading(false);
        return;
      }
      
      const payload = {
        ...formData,
        center_lat: center_lat,
        center_lon: center_lon,
        is_active: true
      };
      
      await api.post("/no-fly-zones/", payload);
      toast.success("Restricted zone created successfully.");
      setIsAdding(false);
      setFormData({ name: "", reason: "", radius_km: 1.0, zone_type: "temporary" });
      setAddressQuery("");
      onRefresh();
      if (!showOverlay) onToggleOverlay(true);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to create zone"));
    } finally {
      setLoading(false);
    }
  };

  const handleFlyTo = (lat, lon) => {
    if (mapInstance) {
      mapInstance.flyTo([lat, lon], 13, { animate: true, duration: 1 });
      if (!showOverlay) onToggleOverlay(true);
    }
  };

  return (
    <div style={{ width: "260px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)" }}>Map Overlay</span>
        <button 
          className={`btn-toggle-mini ${showOverlay ? "active" : ""}`} 
          onClick={() => onToggleOverlay(!showOverlay)}
        >
          {showOverlay ? "Visible" : "Hidden"}
        </button>
      </div>

      {isAdding ? (
        <div style={{ background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)", marginBottom: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--primary)" }}>NEW ZONE</span>
            <X size={14} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setIsAdding(false)} />
          </div>
          
          <input 
            type="text" 
            placeholder="Zone Name (e.g. VIP Event)" 
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", color: "white", padding: "6px 8px", borderRadius: "4px", fontSize: "12px", marginBottom: "8px" }}
          />

          <input 
            type="text" 
            placeholder="Search Address (Required)" 
            value={addressQuery}
            onChange={e => setAddressQuery(e.target.value)}
            style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", color: "white", padding: "6px 8px", borderRadius: "4px", fontSize: "12px", marginBottom: "8px" }}
          />
          
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "10px", color: "var(--muted)", display: "block", marginBottom: "2px" }}>Radius (km)</label>
              <input 
                type="number" 
                min="0.1" max="50" step="0.5"
                value={formData.radius_km}
                onChange={e => setFormData({ ...formData, radius_km: parseFloat(e.target.value) })}
                style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", color: "white", padding: "6px 8px", borderRadius: "4px", fontSize: "12px" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: "10px", color: "var(--muted)", display: "block", marginBottom: "2px" }}>Type</label>
              <select 
                value={formData.zone_type}
                onChange={e => setFormData({ ...formData, zone_type: e.target.value })}
                style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", color: "white", padding: "5px 8px", borderRadius: "4px", fontSize: "12px" }}
              >
                <option value="temporary">Temporary</option>
                <option value="emergency">Emergency</option>
                <option value="permanent">Permanent</option>
              </select>
            </div>
          </div>

          <button 
            onClick={handleAdd} 
            disabled={loading}
            style={{ width: "100%", background: "#ff4d6d", color: "white", border: "none", padding: "6px", borderRadius: "4px", fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: "6px" }}
          >
            <MapPin size={12} /> {loading ? "Adding..." : "Search & Add Zone"}
          </button>
        </div>
      ) : (
        <button 
          onClick={() => setIsAdding(true)}
          style={{ width: "100%", background: "rgba(255, 77, 109, 0.1)", color: "#ff4d6d", border: "1px dashed rgba(255, 77, 109, 0.4)", padding: "8px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: "6px", marginBottom: "12px", transition: "all 0.2s" }}
        >
          <Plus size={14} /> Add Restricted Zone
        </button>
      )}

      <div style={{ maxHeight: "200px", overflowY: "auto", paddingRight: "4px" }} className="custom-scroll">
        {zones.length === 0 ? (
          <div style={{ textAlign: "center", padding: "12px", color: "var(--muted)", fontSize: "11px", fontStyle: "italic" }}>
            No active restricted zones.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {zones.map(z => (
              <div 
                key={z.id} 
                onClick={() => handleFlyTo(z.center_lat, z.center_lon)}
                title="Click to view on map"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", background: "rgba(255,255,255,0.03)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", transition: "background 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
              >
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>{z.name}</div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase" }}>{z.zone_type} • {z.radius_km}km</div>
                </div>
                <button 
                  onClick={(e) => handleDelete(z.id, e)}
                  title="Remove zone"
                  style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: "4px" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#ff4d6d"}
                  onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.3)"}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
