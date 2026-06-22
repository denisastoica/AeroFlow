import React from "react";
import { 
  X, Battery, Activity, Shield, 
  MapPin, Clock, Gauge, Compass,
  AlertTriangle, CheckCircle2, Info,
  Navigation
} from "lucide-react";

export default function DroneDetail({ drone, onClose }) {
  if (!drone) return null;

  return (
    <div className="drone-detail-overlay">
      <div className="drone-detail-modal animate-pop">
        <header className="detail-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ background: 'rgba(106, 228, 255, 0.1)', color: 'var(--primary)', width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Navigation size={28} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>{drone.name}</h2>
              <div className="subtle" style={{ fontSize: 13, fontWeight: 500 }}>ID: DR-{drone.id}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
               <div className="status-badge" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                 <Battery size={12} style={{ marginRight: 6 }} /> {drone.battery?.toFixed(0)}%
               </div>
               <div className="status-badge" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                 <Activity size={12} style={{ marginRight: 6 }} /> {drone.battery_health?.toFixed(0) || 100}%
               </div>
               <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </header>

        <div className="detail-body">
          <div className="grid grid-3">
            <DetailStat label="Current Status" value={drone.status?.toUpperCase().replace('_', ' ')} icon={<Activity size={16} />} color="var(--primary)" />
            <DetailStat label="Ground Speed" value={`${drone.speed?.toFixed(1) || 0} km/h`} icon={<Gauge size={16} />} />
            <DetailStat label="Est. Range" value={`${drone.estimated_range_km?.toFixed(1) || 0} km`} icon={<Compass size={16} />} />
          </div>

          <section className="detail-section">
            <h3 className="section-title">Telemetry & Health</h3>
            <div className="health-grid">
              <HealthBar label="Core Battery" pct={drone.battery} color={drone.battery < 20 ? "#ff4d6d" : (drone.battery < 50 ? "#ffd166" : "#33d69f")} />
              <HealthBar label="Cell Health" pct={drone.battery_health} color={drone.battery_health < 80 ? "#ff4d6d" : "#33d69f"} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div className="mini-stat">
                  <span className="label">Charge Cycles</span>
                  <span className="value">{drone.total_charge_cycles || 0}</span>
                </div>
                <div className="mini-stat">
                  <span className="label">Total Flight</span>
                  <span className="value">{drone.total_flight_km?.toFixed(1) || 0} km</span>
                </div>
              </div>
            </div>
          </section>

          {drone.weather && (
            <section className="detail-section">
              <h3 className="section-title">Environmental Context</h3>
              <div className="weather-detail-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontSize: 32, color: 'var(--primary)' }}>
                    <Info size={32} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>
                      {drone.weather.condition_label || drone.weather.condition} 
                      <span style={{ marginLeft: 8, opacity: 0.5, fontWeight: 500 }}>{drone.weather.temperature}°C</span>
                    </div>
                    <div className="subtle" style={{ fontSize: 12 }}>
                      Wind: {drone.weather.wind_speed} km/h {drone.weather.wind_direction} · Visibility: {drone.weather.visibility_km} km
                    </div>
                  </div>
                </div>
                {drone.weather.warning && (
                  <div className="weather-alert">
                    <AlertTriangle size={14} /> {drone.weather.warning}
                  </div>
                )}
                <div className="weather-multipliers">
                  <div className="multiplier">
                    <span className="label">Speed Multiplier</span>
                    <span className="value" style={{ color: drone.weather.speed_multiplier < 1 ? '#ffd166' : 'inherit' }}>x{drone.weather.speed_multiplier}</span>
                  </div>
                  <div className="multiplier">
                    <span className="label">Battery Multiplier</span>
                    <span className="value" style={{ color: drone.weather.battery_multiplier > 1 ? '#ff4d6d' : 'inherit' }}>x{drone.weather.battery_multiplier}</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {drone.delivery_id && (
             <section className="detail-section">
                <h3 className="section-title">Active Mission Assignment</h3>
                <div className="mission-detail-card">
                  <div className="mission-head">
                    <span className="mission-id">Assignment #{drone.delivery_id}</span>
                    <span className="mission-eta">ETA: {drone.eta_minutes || 12} min</span>
                  </div>
                  <div className="mission-route">
                    <div className="route-point">
                      <MapPin size={14} color="#a78bfa" />
                      <span>Distribution Center B-4</span>
                    </div>
                    <div className="route-line" />
                    <div className="route-point">
                      <MapPin size={14} color="#33d69f" />
                      <span>Delivery Point (Oradea)</span>
                    </div>
                  </div>
                </div>
             </section>
          )}
        </div>

        <footer className="detail-footer">
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>Close Overview</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => window.location.href=`/missions`}>
             Open Flight Log
          </button>
        </footer>
      </div>

      <style>{`
        .drone-detail-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.4); backdrop-filter: blur(10px);
          display: flex; align-items: center; justify-content: center; z-index: 4000;
        }
        .drone-detail-modal {
          background: #0f172a; border: 1px solid rgba(255,255,255,0.08);
          border-radius: 28px; width: 100%; max-width: 550px;
          box-shadow: 0 30px 60px rgba(0,0,0,0.5);
          overflow: hidden;
        }
        .detail-header {
          padding: 24px 32px; border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex; justify-content: space-between; align-items: center;
        }
        .detail-body { padding: 32px; display: flex; flex-direction: column; gap: 32px; max-height: 70vh; overflow-y: auto; }
        .detail-section { display: flex; flex-direction: column; gap: 16px; }
        .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.3); margin: 0; font-weight: 800; }
        
        .detail-stat {
          background: rgba(255,255,255,0.03); padding: 16px; border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .detail-stat .label { font-size: 10px; color: rgba(255,255,255,0.4); margin-bottom: 8px; font-weight: 700; }
        .detail-stat .value { font-size: 14px; fontWeight: 800; display: flex; align-items: center; gap: 8px; }
        
        .health-bar-container { margin-bottom: 12px; }
        .health-bar-label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; font-weight: 700; }
        .health-bar-bg { height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
        .health-bar-fill { height: 100%; transition: width 0.5s; }
        
        .mini-stat { display: flex; flex-direction: column; }
        .mini-stat .label { font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 700; }
        .mini-stat .value { font-size: 16px; font-weight: 800; }
        
        .weather-detail-card {
          background: rgba(106, 228, 255, 0.03); border: 1px solid rgba(106, 228, 255, 0.1);
          border-radius: 20px; padding: 20px;
        }
        .weather-alert {
          margin-top: 16px; background: rgba(255,77,109,0.1); color: #ff4d6d;
          padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 700;
          display: flex; align-items: center; gap: 8px; border: 1px solid rgba(255,77,109,0.15);
        }
        .weather-multipliers { display: flex; gap: 24px; margin-top: 20px; }
        .multiplier .label { font-size: 10px; opacity: 0.5; display: block; margin-bottom: 2px; }
        .multiplier .value { font-weight: 800; font-size: 14px; }
        
        .mission-detail-card {
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
          border-radius: 20px; padding: 20px;
        }
        .mission-head { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .mission-id { font-weight: 800; color: var(--primary); }
        .mission-eta { font-size: 13px; font-weight: 700; opacity: 0.7; }
        .mission-route { display: flex; flex-direction: column; gap: 8px; position: relative; }
        .route-point { display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 600; }
        .route-line { width: 2px; height: 20px; background: rgba(255,255,255,0.1); margin-left: 6px; }
        
        .detail-footer { padding: 24px 32px; display: flex; gap: 12px; border-top: 1px solid rgba(255,255,255,0.05); }
      `}</style>
    </div>
  );
}

function DetailStat({ label, value, icon, color }) {
  return (
    <div className="detail-stat">
      <div className="label">{label}</div>
      <div className="value" style={color ? { color } : {}}>
        <span style={{ opacity: 0.5 }}>{icon}</span>
        {value}
      </div>
    </div>
  );
}

function HealthBar({ label, pct, color }) {
  return (
    <div className="health-bar-container">
      <div className="health-bar-label">
        <span>{label}</span>
        <span>{pct?.toFixed(1)}%</span>
      </div>
      <div className="health-bar-bg">
        <div className="health-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
