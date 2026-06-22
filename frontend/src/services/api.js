import axios from "axios";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://127.0.0.1:8000";

export function getWsMonitorUrl(token) {
  if (!token) return null;
  try {
    const u = new URL(API_BASE_URL);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${u.host}/ws/monitor?token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

export function getErrorMessage(err, fallback = "Something went wrong") {
  const detail = err?.response?.data?.detail;
  if (!detail) return err?.message || fallback;
  if (typeof detail === "string") return detail;
  if (detail.message && typeof detail.message === "string") return detail.message;
  if (detail.msg && typeof detail.msg === "string") return detail.msg;
  if (Array.isArray(detail)) {
    return detail.map((d) => (typeof d === "string" ? d : d.msg || JSON.stringify(d))).join("; ");
  }
  try { return JSON.stringify(detail); } catch { return fallback; }
}

let _onUnauthorized = null;
export const setOnUnauthorized = (cb) => {
  _onUnauthorized = cb;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("access_token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
            const isAuthUrl = error.config.url.includes("/auth/login") || 
                        error.config.url.includes("/auth/register") || 
                        error.config.url.includes("/auth/logout") || 
                        error.config.url.includes("/auth/me") ||
                        error.config.url.includes("/auth/forgot-password") ||
                        error.config.url.includes("/auth/reset-password");
      
      if (!isAuthUrl) {
        const hasToken = !!localStorage.getItem("access_token");
        if (hasToken) {
          localStorage.setItem("session_expired", "1");
        }
        
        if (_onUnauthorized) {
          _onUnauthorized();
        } else {
                    localStorage.removeItem("access_token");
          localStorage.removeItem("user");
        }
      }
    }

    return Promise.reject(error);
  }
);

export const AUTH_CHANGED_EVENT = "drone-platform-auth-changed";

export const authAPI = {
  register: (data) => api.post("/auth/register", data),
  login: (data) => api.post("/auth/login", data),
  getProfile: () => api.get("/auth/me"),
  logout: () => api.post("/auth/logout"),
  forgotPassword: (data) => api.post("/auth/forgot-password", data),
  resetPassword: (data) => api.post("/auth/reset-password", data),
};

export const deliveriesAPI = {
  create: (data) => api.post("/deliveries/", data),
  list: (status = null) =>
    api.get("/deliveries/", { params: status ? { status } : {} }),
  getById: (id) => api.get(`/deliveries/${id}`),
  assign: (id) => api.post(`/deliveries/${id}/assign`),
  cancel: (id) => api.post(`/deliveries/${id}/cancel`),
  forceCancel: (id) => api.patch(`/deliveries/${id}/force-cancel`),
  reassign: (id, droneId) => api.post(`/deliveries/${id}/reassign`, { drone_id: droneId }),
  batchAssign: () => api.post("/deliveries/batch-assign"),
  getDroneScores: (id) => api.get(`/deliveries/fleet/scores/${id}`),
  getRankingDebug: (id) => api.get(`/deliveries/fleet/ranking-debug/${id}`),
  updateStatus: (id, status) =>
    api.patch(`/deliveries/${id}/status`, { new_status: status }),
  track: (id) => api.get(`/deliveries/${id}/track`),
  timeline: (id) => api.get(`/deliveries/${id}/timeline`),
  diagnostics: (id) => api.get(`/deliveries/${id}/diagnostics`),
  search: (filters, params) => api.post("/deliveries/search", filters, { params }),
  history: (params) => api.get("/deliveries/history/completed", { params }),

  getDashboardCustomer: () => api.get("/deliveries/dashboard/customer"),
  getDashboardDispatcher: () => api.get("/deliveries/dashboard/dispatcher"),
  getAnalytics: (params) => api.get("/deliveries/dashboard/analytics", { params }),
  getStats: () => api.get("/deliveries/dashboard/stats"),
  estimate: (data) => api.post("/deliveries/estimate", data),
};

export const usersAPI = {
  list: () => api.get("/users/"),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post("/users/", data),
  update: (id, data) => api.patch(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
};

export const auditAPI = {
  list: (params) => api.get("/audit/logs", { params }),
  getEntityHistory: (type, id) => api.get(`/audit/entity/${type}/${id}`),
  getUserActivity: (userId, params) => api.get(`/audit/user/${userId}/activity`, { params }),
  getOverrides: (params) => api.get("/audit/overrides", { params }),
  getRecent: (limit = 50) => api.get("/audit/recent", { params: { limit } }),
  getSummary: (params) => api.get("/audit/summary", { params }),
  getActionTypes: () => api.get("/audit/actions/types"),
  exportCsv: (params) => api.get("/audit/export/csv", { params, responseType: 'blob' }),
};

export const systemAPI = {
  getHealth: () => api.get("/system/health"),
};

export const proofOfDeliveryAPI = {
  getProof: (deliveryId) => api.get(`/deliveries/${deliveryId}/proof`),
  uploadPhoto: (deliveryId, photoUrl) => api.patch(`/deliveries/${deliveryId}/photo`, { photo_url: photoUrl }),
  confirm: (deliveryId, data) => api.post(`/deliveries/${deliveryId}/confirm`, data),
};

export const dronesAPI = {
  list: () => api.get("/drones/"),
  getById: (id) => api.get(`/drones/${id}`),
  create: (data) => api.post("/drones/", data),
  update: (id, data) => api.patch(`/drones/${id}`, data),
  delete: (id) => api.delete(`/drones/${id}`),
  returnToService: (id) => api.post(`/drones/${id}/return-to-service`),
  fleetStatus: () => api.get("/drones/fleet-status"),
  sendToCharge: (id) => api.post(`/drones/${id}/send-to-charge`),
};

export const weatherAPI = {
  getCurrent: () => api.get("/weather/"),
  getAt: (lat, lon) => api.get("/weather/at", { params: { lat, lon } }),
  getImpact: (lat, lon) => api.get("/weather/impact", { params: { lat, lon } }),
  getWarnings: () => api.get("/weather/warnings"),
};

export const radarAPI = {
    getList: () => api.get("/weather/radar/list"),
    getImageUrl: (filename) => `${API_BASE_URL}/weather/radar/image/${filename}`,
};

export const missionsAPI = {
  list: (params) => api.get("/missions/", { params }),
  stats: () => api.get("/missions/stats"),
  getEvents: (missionId) => api.get(`/missions/${missionId}/events`),
  getReplay: (missionId) => api.get(`/missions/${missionId}/replay`),
  getProgress: (missionId) => api.get(`/missions/${missionId}/progress`),
  pause: (missionId) => api.post(`/missions/${missionId}/pause`),
  resume: (missionId) => api.post(`/missions/${missionId}/resume`),
  fail: (missionId, reason) => api.patch(`/missions/${missionId}/fail`, { reason }),
};

export const simulatorAPI = {
  getStatus: () => api.get("/simulator/status"),
  pause: () => api.post("/simulator/pause"),
  resume: () => api.post("/simulator/resume"),
  abortMission: (droneId) => api.post(`/simulator/abort_mission/${droneId}`),
  resetFleet: () => api.post("/simulator/reset-fleet"),
  listScenarios: () => api.get("/simulator/scenarios"),
  runScenario: (scenarioId) => api.post(`/simulator/scenario/${scenarioId}`),
  clearWeather: () => api.post("/simulator/scenario/clear-weather"),
};

export const noFlyZonesAPI = {
  list: (activeOnly = true) => api.get("/no-fly-zones/", { params: { active_only: activeOnly } }),
  create: (data) => api.post("/no-fly-zones/", data),
  update: (id, data) => api.put(`/no-fly-zones/${id}`, data),
  delete: (id) => api.delete(`/no-fly-zones/${id}`),
  checkPoint: (lat, lon) => api.get("/no-fly-zones/check", { params: { lat, lon } }),
  checkRoute: (path) => api.post("/no-fly-zones/check-route", path),
};

export const chargingAPI = {
  getStations: () => api.get("/charging/stations"),
  createStation: (data) => api.post("/charging/stations", data),
  updateStation: (id, data) => api.put(`/charging/stations/${id}`, data),
  deleteStation: (id) => api.delete(`/charging/stations/${id}`),
};

export const geocodingAPI = {
  search: (q) => api.get("/geocoding/search", { params: { q } }),
  reverse: (lat, lon) => api.get("/geocoding/reverse", { params: { lat, lon } }),
};

export const alertsAPI = {
  list: (params) => api.get("/alerts/", { params }),
  summary: () => api.get("/alerts/summary"),
  getRecent: (limit = 10) => api.get("/alerts/", { params: { limit, status: "new" } }),
  acknowledge: (id) => api.patch(`/alerts/${id}/acknowledge`),
  resolve: (id) => api.patch(`/alerts/${id}/resolve`),
  resolveSimilar: (alertId) => api.post("/alerts/resolve-similar", null, { params: { alert_id: alertId } }),
  acknowledgeSimilar: (alertId) => api.post("/alerts/acknowledge-similar", null, { params: { alert_id: alertId } }),
  acknowledgeAll: (severity = null) => api.post("/alerts/acknowledge-all", null, { params: severity ? { severity } : {} }),
};

export const settingsAPI = {
  get: () => api.get("/settings/"),
  update: (data) => api.post("/settings/", data),
};

export default api;