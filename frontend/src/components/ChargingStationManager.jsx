import React, { useState } from "react";
import api, { getErrorMessage, chargingAPI } from "../services/api";
import { useToast } from "../hooks/useToast";
import { Zap, Plus, Trash2, MapPin } from "lucide-react";

export default function ChargingStationManager({ 
  stations = [], 
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
  });

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await chargingAPI.deleteStation(id);
      toast.success("Charging station removed.");
      onRefresh();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to remove station"));
    }
  };

  const handleToggleActive = async (station, e) => {
    e.stopPropagation();
    try {
      await chargingAPI.updateStation(station.id, { active: !station.active });
      toast.success(`Station ${station.active ? 'disabled' : 'enabled'}.`);
      onRefresh();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to update station"));
    }
  }

  const handleAdd = async () => {
    if (!formData.name) return toast.error("Station name is required.");
    if (!addressQuery.trim()) return toast.error("Address is required.");
    
    setLoading(true);
    try {
      let lat, lon;
      const geoRes = await api.get(`/geocoding/search?q=${encodeURIComponent(addressQuery.trim())}`);
      if (geoRes.data && geoRes.data.success) {
        lat = geoRes.data.lat;
        lon = geoRes.data.lon;
        if (mapInstance) {
          mapInstance.flyTo([lat, lon], 14, { animate: true });
        }
      } else {
        toast.error("Could not find coordinates for that address.");
        setLoading(false);
        return;
      }

      await chargingAPI.createStation({
        name: formData.name,
        latitude: lat,
        longitude: lon,
        active: true
      });

      toast.success("Charging station added successfully.");
      setIsAdding(false);
      setFormData({ name: "" });
      setAddressQuery("");
      onRefresh();
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to add station"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="nfz-manager">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={showOverlay} 
            onChange={(e) => onToggleOverlay(e.target.checked)}
          />
          <span className="slider"></span>
        </label>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Show on Map</span>
      </div>

      {!isAdding ? (
        <button 
          className="btn btn-outline" 
          style={{ width: '100%', marginBottom: '12px' }}
          onClick={() => setIsAdding(true)}
        >
          <Plus size={16} style={{ marginRight: '6px' }} />
          Add Charging Station
        </button>
      ) : (
        <div style={{ background: 'var(--surface-sunken)', padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>
          <input
            className="input"
            placeholder="Station Name (e.g. Cluj Hub)"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            style={{ width: '100%', marginBottom: '8px' }}
          />
          <input
            className="input"
            placeholder="Address or City"
            value={addressQuery}
            onChange={e => setAddressQuery(e.target.value)}
            style={{ width: '100%', marginBottom: '12px' }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleAdd} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </button>
            <button className="btn btn-outline" onClick={() => setIsAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="nfz-list" style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {stations.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '12px' }}>
            No charging stations found.
          </div>
        ) : (
          stations.map(st => (
            <div key={st.id || st.name} style={{
              background: 'var(--surface)',
              border: `1px solid ${st.active === false ? 'var(--danger-alpha)' : 'var(--border-color)'}`,
              padding: '8px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
              opacity: st.active === false ? 0.7 : 1,
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}
            onClick={() => {
              if (mapInstance && st.lat && st.lon) {
                mapInstance.flyTo([st.lat, st.lon], 13, { animate: true });
              }
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', color: st.active === false ? 'var(--text-muted)' : 'var(--text)', textAlign: 'left' }}>
                  <Zap size={16} fill={st.active !== false ? "#eab308" : "none"} color={st.active === false ? "var(--text-muted)" : "#eab308"} />
                  <span>{st.name} {st.active === false && <span style={{fontSize: '11px', fontWeight: 'normal'}}>(Inactive)</span>}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {st.id && (
                    <>
                      <button 
                        onClick={(e) => handleToggleActive(st, e)}
                        style={{ 
                          background: st.active ? 'var(--surface-sunken)' : 'rgba(16, 185, 129, 0.1)', 
                          border: 'none', 
                          padding: '4px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer', 
                          fontSize: '11px', 
                          fontWeight: '600',
                          color: st.active ? 'var(--text-muted)' : 'var(--success)' 
                        }}
                        title={st.active ? "Disable Station" : "Enable Station"}
                      >
                        {st.active ? "Disable" : "Enable"}
                      </button>
                      <button 
                        onClick={(e) => handleDelete(st.id, e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'flex', padding: '4px' }}
                        title="Delete Station"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '22px' }}>
                <MapPin size={12} />
                {parseFloat(st.lat).toFixed(4)}, {parseFloat(st.lon).toFixed(4)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
