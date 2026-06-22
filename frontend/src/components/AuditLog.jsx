import React, { useState, useEffect, useCallback, useMemo } from "react";
import { auditAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { Skeleton } from "./Skeleton";
import { formatBackendDateTime, parseBackendDateTime } from "../utils/datetime";
import { 
  FileText, Search, Filter, Download, 
  User, Activity, Calendar, Eye, 
  ArrowRight, Shield, Clock, Database,
  RefreshCw, X, ShieldAlert, Box, 
  ClipboardList, Info, Globe, Fingerprint, 
  Zap, Settings, ShieldCheck, ChevronRight,
  ArrowUpDown, CheckCircle, Trash2, Edit3,
  ExternalLink, CalendarDays, History, Layers,
  ChevronDown, ChevronUp, ChevronLeft
} from "lucide-react";

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [showDetail, setShowDetail] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [groupSimilar, setGroupSimilar] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});
  
    const [filters, setFilters] = useState({
    entity_type: "all",
    action_prefix: "all",
    date_from: "",
    date_to: "",
  });

  const [activeFilters, setActiveFilters] = useState({ ...filters });

  const toast = useToast();

  const isDateOnlyValue = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  const toUtcBoundaryIso = (value, endOfDay = false) => {
    if (!value) return undefined;

    if (isDateOnlyValue(value)) {
      const [year, month, day] = value.split("-").map(Number);
      const date = endOfDay
        ? new Date(year, month - 1, day, 23, 59, 59, 999)
        : new Date(year, month - 1, day, 0, 0, 0, 0);
      return date.toISOString();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };

  const toDateInputValue = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page,
        page_size: pageSize,
      };
      if (activeFilters.entity_type !== "all") params.entity_type = activeFilters.entity_type;
      
      if (activeFilters.action_prefix !== "all") {
        if (activeFilters.action_prefix === "SYSTEM_") {
          params.system_only = true;
        } else if (activeFilters.action_prefix === "OVERRIDE_") {
          params.security_only = true;
        } else if (activeFilters.action_prefix === "USER_") {
          params.user_only = true;
        } else {
          params.action_prefix = activeFilters.action_prefix;
        }
      }
      
      if (activeFilters.date_from) params.date_from = toUtcBoundaryIso(activeFilters.date_from, false);
      if (activeFilters.date_to) params.date_to = toUtcBoundaryIso(activeFilters.date_to, true);

      const res = await auditAPI.list(params);
      setLogs(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to load audit logs"));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeFilters, toast]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleApplyFilters = () => {
    setPage(1);
    setActiveFilters({ ...filters });
  };

  const handleResetFilters = () => {
    const reset = { entity_type: "all", action_prefix: "all", date_from: "", date_to: "" };
    setFilters(reset);
    setActiveFilters(reset);
    setSearchTerm("");
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const res = await auditAPI.exportCsv({
         entity_type: activeFilters.entity_type !== "all" ? activeFilters.entity_type : undefined,
        date_from: activeFilters.date_from ? toUtcBoundaryIso(activeFilters.date_from, false) : undefined,
        date_to: activeFilters.date_to ? toUtcBoundaryIso(activeFilters.date_to, true) : undefined,
      });
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("Audit log exported successfully");
    } catch (err) {
      toast.error("Failed to export audit log");
    }
  };

  const handleQuickRange = (range) => {
    const now = new Date();
    let newFilters;

    if (range === '24h') {
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      newFilters = { ...filters, date_from: from, date_to: now.toISOString() };
    } else {
      let from = "";
      if (range === 'today') from = toDateInputValue(now);
      if (range === 'week') from = toDateInputValue(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      newFilters = { ...filters, date_from: from, date_to: now.toISOString() };
    }
    
    setFilters(newFilters);
    setActiveFilters(newFilters);
    setPage(1);
  };

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const processedLogs = useMemo(() => {
    let result = [...logs];
    
        if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(log => 
        getAuditActor(log).label.toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term) ||
        (log.description || "").toLowerCase().includes(term) ||
        log.entity_type.toLowerCase().includes(term) ||
        log.entity_id?.toString().includes(term)
      );
    }

        result.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (sortField === 'created_at') {
        valA = new Date(valA).getTime();
        valB = new Date(valB).getTime();
      }
      if (sortField === 'actor') {
        valA = getAuditActor(a).label;
        valB = getAuditActor(b).label;
      }
      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

        if (groupSimilar && sortField === 'created_at') {
      const groupMap = new Map();
      const groupedOrder = [];

      result.forEach((log) => {
        const actor = getAuditActor(log);
        
        const isSensitive = [
            "OVERRIDE_", "ROLE_CHANGED", "DISABLE", "DISABLED", 
            "DEACTIVATED", "SUSPENDED", "RETIRED", "RETURN_TO_SERVICE", "MAINTENANCE_RETURN"
        ].some(p => String(log.action).toUpperCase().includes(p));

                let stateHash = "";
        if (isSensitive) {
            stateHash = `-state-${JSON.stringify(log.new_value)}-${JSON.stringify(log.old_value)}-${JSON.stringify(log.extra_data)}`;
        }

        const groupKey = `${log.action}-${actor.key}-${log.entity_id}${stateHash}`;
        
        if (groupMap.has(groupKey)) {
          groupMap.get(groupKey).items.push(log);
        } else {
          const newGroup = {
            id: `group-${log.id}`,
            key: groupKey,
            main: log,
            items: [log],
            count: 1
          };
          groupMap.set(groupKey, newGroup);
          groupedOrder.push(newGroup);
        }
      });
      
      const grouped = groupedOrder;
      
            const final = [];
      grouped.forEach(group => {
        if (group.items.length > 1) {
          const isExpanded = expandedGroups[group.id];
          final.push({
            ...group.main,
            _isGroupHeader: true,
            _groupCount: group.items.length,
            _groupHiddenCount: group.items.length - 1,
            _groupId: group.id,
            _isExpanded: isExpanded,
          });
          if (isExpanded) {
                        group.items.slice(1).forEach((item, idx) => {
               final.push({ ...item, _isGroupItem: true, _groupIndex: idx + 1 });
            });
          }
        } else {
          final.push(group.main);
        }
      });
      return final;
    }

    return result;
  }, [logs, searchTerm, sortField, sortDir, groupSimilar, expandedGroups]);

  const [globalStats, setGlobalStats] = useState({
    totalToday: 0,
    security: 0,
    userActions: 0,
    systemEvents: 0
  });

  useEffect(() => {
        const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    
        const params = {};
    if (activeFilters.date_from) {
      params.date_from = toUtcBoundaryIso(activeFilters.date_from, false);
    } else {
      params.date_from = startOfDay;
    }
    
    if (activeFilters.date_to) {
      params.date_to = toUtcBoundaryIso(activeFilters.date_to, true);
    }

    auditAPI.getSummary(params).then(res => {
      setGlobalStats({
        totalToday: res.data.total_actions || 0,
        security: res.data.security_actions || 0,
        userActions: res.data.user_actions || 0,
        systemEvents: res.data.system_actions || 0
      });
    }).catch(err => console.error("Failed to fetch global audit stats", err));
  }, [activeFilters.date_from, activeFilters.date_to]);

  const getEventStyle = (action) => {
    const normalized = String(action || '').toUpperCase();

    if (normalized.includes('LOGIN') || normalized.includes('LOGOUT')) {
      return { label: 'Authentication', color: '#6ae4ff', bg: 'rgba(106, 228, 255, 0.12)', icon: <Fingerprint size={14} /> };
    }

    if (normalized.includes('OVERRIDE')) {
      return { label: 'Administrative Override', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)', icon: <Settings size={14} /> };
    }

    if (
      normalized.includes('ROLE_CHANGED') ||
      normalized.includes('DISABLE') ||
      normalized.includes('DISABLED') ||
      normalized.includes('SUSPEND') ||
      normalized.includes('UNAUTHORIZED') ||
      normalized.includes('FORBIDDEN')
    ) {
      return { label: 'Security Alert', color: '#ff4d6d', bg: 'rgba(255, 77, 109, 0.12)', icon: <ShieldAlert size={14} /> };
    }

    if (normalized.includes('DELETE') || normalized.includes('RETIRED') || normalized.includes('DEACTIVATED')) {
      return { label: 'Deletion', color: '#fb7185', bg: 'rgba(251, 113, 133, 0.14)', icon: <Trash2 size={14} /> };
    }

    if (normalized.includes('CREATE')) {
      return { label: 'Addition', color: '#33d69f', bg: 'rgba(51, 214, 159, 0.12)', icon: <Zap size={14} /> };
    }

    if (normalized.includes('UPDATE') || normalized.includes('SETTINGS') || normalized.includes('STATUS_CHANGED')) {
      return { label: 'Update', color: '#ffd166', bg: 'rgba(255, 209, 102, 0.12)', icon: <Edit3 size={14} /> };
    }

    return { label: 'System Event', color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.08)', icon: <Database size={14} /> };
  };

  const getEntityBadge = (type) => {
    const styles = {
      user: { color: '#6ae4ff', icon: <User size={12} /> },
      drone: { color: '#33d69f', icon: <Box size={12} /> },
      delivery: { color: '#ffd166', icon: <ClipboardList size={12} /> },
      system: { color: '#adb5bd', icon: <Database size={12} /> }
    };
    const s = styles[type.toLowerCase()] || styles.system;
    return (
      <div className="entity-ref-badge-premium" style={{ color: s.color, border: `1px solid ${s.color}22` }}>
        {s.icon}
        <span>{type.toUpperCase()}</span>
        <ExternalLink size={10} className="link-icon" />
      </div>
    );
  };

  return (
    <div className="stack theme-admin audit-main-layout">
      <header className="page-header">
        <div style={{ marginLeft: -24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Shield size={28} color="var(--primary)" style={{ flexShrink: 0, marginTop: 4 }} />
            <div>
              <h1 style={{ margin: 0 }}>Audit Intelligence</h1>
              <p className="subtle" style={{ margin: 0, marginTop: 4 }}>Real-time traceability and security analysis engine.</p>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
           <button className="btn btn-ghost btn-sm" onClick={handleExport} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Download size={14} /> Export
          </button>
          <button className="btn btn-primary btn-sm" onClick={fetchLogs} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </header>

            <div className="grid grid-4 kpi-row" style={{ gap: 16 }}>
        <SummaryCard label="Total Events" value={globalStats.totalToday} icon={<CalendarDays size={20} />} color="#6ae4ff" onClick={() => { const newFilters = { ...filters, action_prefix: 'all' }; setFilters(newFilters); setPage(1); setActiveFilters(newFilters); }} />
        <SummaryCard label="Security & Access Events" value={globalStats.security} icon={<Shield size={20} />} color="#ff4d6d" onClick={() => { const newFilters = { ...filters, action_prefix: 'OVERRIDE_' }; setFilters(newFilters); setPage(1); setActiveFilters(newFilters); }} />
        <SummaryCard label="User Activity" value={globalStats.userActions} icon={<User size={20} />} color="#33d69f" onClick={() => { const newFilters = { ...filters, action_prefix: 'USER_' }; setFilters(newFilters); setPage(1); setActiveFilters(newFilters); }} />
        <SummaryCard label="System Events" value={globalStats.systemEvents} icon={<Database size={20} />} color="#ffd166" onClick={() => { const newFilters = { ...filters, action_prefix: 'SYSTEM_' }; setFilters(newFilters); setPage(1); setActiveFilters(newFilters); }} />
      </div>

            <div className="card">
        <div className="card-body stack" style={{ gap: 14, padding: '14px 20px' }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ flex: 1, position: "relative" }}>
               <Search size={16} className="subtle" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
               <input 
                type="text" 
                placeholder="Search actor, entity or action..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="audit-input-premium"
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
               <button className="btn btn-primary" onClick={handleApplyFilters} style={{ padding: '0 24px', height: 38, fontSize: 13 }}>Filter</button>
               <button className="btn btn-ghost" onClick={handleResetFilters} title="Reset all" style={{ width: 38, padding: 0 }}><History size={16} /></button>
            </div>
          </div>

          <div className="filter-controls-row">
            <div className="dropdown-cluster">
              <select className="audit-select-compact" value={filters.entity_type} onChange={(e) => setFilters({...filters, entity_type: e.target.value})}>
                <option value="all">Entities</option>
                <option value="user">Users</option>
                <option value="drone">Drones</option>
                <option value="delivery">Deliveries</option>
                <option value="system">System</option>
              </select>
              <select className="audit-select-compact" value={filters.action_prefix} onChange={(e) => setFilters({...filters, action_prefix: e.target.value})}>
                <option value="all">Actions</option>
                <option value="USER_">User</option>
                <option value="DRONE_">Drone</option>
                <option value="DELIVERY_">Delivery</option>
                <option value="OVERRIDE_">Security</option>
                <option value="SYSTEM_">System</option>
              </select>
            </div>

            <div className="quick-chips-group">
               <button className="chip" onClick={() => handleQuickRange('today')}>Today</button>
               <button className="chip" onClick={() => handleQuickRange('24h')}>24h</button>
               <button className="chip" onClick={() => handleQuickRange('week')}>Week</button>
               <div className="divider-v" />
               <label className="toggle-label">
                  <input type="checkbox" checked={groupSimilar} onChange={(e) => setGroupSimilar(e.target.checked)} />
                  <span>Group Repetitive</span>
               </label>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="card-body"><Skeleton count={12} height={36} style={{ marginBottom: 6 }} /></div></div>
      ) : processedLogs.length === 0 ? (
        <div className="empty-audit-state">
          <Info size={40} className="subtle" />
          <h3>No events found</h3>
          <p className="subtle">Refine your search or clear filters to see more activity.</p>
          <button className="btn btn-ghost" onClick={handleResetFilters} style={{ marginTop: 16 }}>Clear Filters</button>
        </div>
      ) : (
        <div className="card table-container-premium">
          <table className="audit-data-table-dense">
            <thead>
              <tr>
                <th style={{ width: 140 }} onClick={() => toggleSort("created_at")}>
                  Timestamp {sortField === 'created_at' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => toggleSort("actor")}>
                  Initiating Actor {sortField === 'actor' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th>Operation & Description</th>
                <th style={{ width: 140 }}>Target Asset</th>
                <th style={{ textAlign: "right", width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {processedLogs.map((log, idx) => {
                const style = getEventStyle(log.action);
                const actor = getAuditActor(log);
                const isGroupHeader = log._isGroupHeader;
                const isGroupItem = log._isGroupItem;
                
                return (
                  <tr key={log.id} className={`${isGroupHeader ? 'row-group-header' : ''} ${isGroupItem ? 'row-group-item' : ''}`}>
                    <td>
                      <div className="timestamp-stack-compact">
                        <span className="date">{fmtDateCompact(log.created_at)}</span>
                        <span className="time">{fmtTimeCompact(log.created_at)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="actor-cluster-compact">
                        <div
                          className="status-dot"
                          style={{
                            background: actor.tone === 'admin' ? '#a855f7' : actor.tone === 'system' ? '#ffd166' : 'var(--primary)'
                          }}
                        />
                        <span className="email">{actor.label}</span>
                      </div>
                    </td>
                    <td>
                      <div className="op-cluster-compact">
                        <div className="op-badge-pill" style={{ color: style.color, background: style.bg }}>
                          {style.icon}
                          <span>{log.action.replace(/_/g, ' ')}</span>
                          {isGroupHeader && (
                            <span className="group-count-badge">{log._groupCount} events ({log._groupHiddenCount} more)</span>
                          )}
                        </div>
                        <p className="op-description-text">{log.description || 'No description provided.'}</p>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {getEntityBadge(log.entity_type)}
                        <span className="id-mono">#{log.entity_id || '---'}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {isGroupHeader && (
                          <button
                            className="btn-table-action"
                            onClick={() => toggleGroup(log._groupId)}
                            title={log._isExpanded ? "Collapse grouped events" : `Expand to view ${log._groupCount} grouped events`}
                            aria-label={log._isExpanded ? "Collapse grouped events" : `Expand grouped events (${log._groupCount})`}
                          >
                            {log._isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>
                        )}
                        <button className="btn-table-inspect" onClick={() => setShowDetail(log)}>
                          <Eye size={13} />
                          <span>Inspect</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          <div className="audit-table-footer-premium">
            <div className="records-count">
              <span className="dot-live" />
              SHOWING {logs.length} OF {total} AUDIT TRACE RECORDS
              {logs.length !== processedLogs.length && (
                <span style={{ textTransform: 'lowercase', opacity: 0.6, fontWeight: 600, marginLeft: 4 }}>
                  (grouped into {processedLogs.length} rows)
                </span>
              )}
            </div>
            <div className="pagination-premium">
              <button 
                className="btn-pagination-nav" 
                disabled={page === 1} 
                onClick={() => setPage(p => p - 1)}
                title="Previous Page"
              >
                <ChevronLeft size={16} />
                <span>Prev</span>
              </button>
              
              <div className="pagination-info">
                <span className="current">Page {page}</span>
                <span className="total">of {Math.ceil(total / pageSize) || 1}</span>
              </div>
              
              <button 
                className="btn-pagination-nav" 
                disabled={logs.length < pageSize} 
                onClick={() => setPage(p => p + 1)}
                title="Next Page"
              >
                <span>Next</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

            <div className={`audit-drawer-overlay ${showDetail ? 'visible' : ''}`} onClick={() => setShowDetail(null)}>
        <div className={`audit-drawer ${showDetail ? 'open' : ''}`} onClick={e => e.stopPropagation()}>
          {showDetail && (
            <>
              <div className="drawer-header-compact-fixed">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="drawer-type-icon" style={{ 
                    background: getEventStyle(showDetail.action).bg,
                    color: getEventStyle(showDetail.action).color
                  }}>
                    {getEventStyle(showDetail.action).icon}
                  </div>
                  <div>
                    <h2 className="drawer-title-final">{showDetail.action.replace(/_/g, ' ')}</h2>
                    <div className="drawer-meta-final">
                      <span className="cat" style={{ color: getEventStyle(showDetail.action).color }}>
                        {getEventStyle(showDetail.action).label}
                      </span>
                      <span className="dot">•</span>
                      <span className="ts">{fmtFriendlyFull(showDetail.created_at)}</span>
                    </div>
                  </div>
                </div>
                <button className="btn-close-final" onClick={() => setShowDetail(null)}>
                  <X size={16} />
                </button>
              </div>

              <div className="drawer-body-compact-scroll">
                <section className="drawer-section-final">
                  <h4 className="section-heading-final">Audit Context</h4>
                  <div className="detail-grid-final">
                    <DetailBox label="Initiating Actor" value={getAuditActor(showDetail).label} icon={<User size={12} />} />
                    <DetailBox label="Network IP" value={showDetail.ip_address || '127.0.0.1 (Local)'} icon={<Globe size={12} />} isMono />
                    <DetailBox label="Target Asset" value={`${showDetail.entity_type.toUpperCase()} #${showDetail.entity_id || 'Global'}`} icon={<Box size={12} />} />
                    <DetailBox label="Audit Trace ID" value={`AUDIT-${showDetail.id}`} icon={<Fingerprint size={12} />} isMono />
                  </div>
                </section>

                <section className="drawer-section-final">
                  <h4 className="section-heading-final">Event Description</h4>
                  <div className="description-card-final">
                    <Info size={14} className="info-icon" />
                    <p>{formatFriendlyDesc(showDetail)}</p>
                  </div>
                </section>

                {(showDetail.old_value !== null || showDetail.new_value !== null) ? (
                  <section className="drawer-section-final">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 className="section-heading-final">State Change Analysis</h4>
                      <div className="mutation-tag">Mutation Recorded</div>
                    </div>
                    <div className="transition-map-final">
                      <div className="panel-map old">
                        <span className="tag">ORIGINAL STATE</span>
                        <div className="pre-wrap">
                          <pre>{JSON.stringify(toReadableAuditState(showDetail.old_value), null, 2) || '// No prior state'}</pre>
                        </div>
                      </div>
                      <div className="panel-map new">
                        <span className="tag">MODIFIED STATE</span>
                        <div className="pre-wrap">
                          <pre>{JSON.stringify(toReadableAuditState(showDetail.new_value), null, 2) || '// No data change'}</pre>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="drawer-section-final">
                    <h4 className="section-heading-final">State Change Analysis</h4>
                    <div className="no-mutation-card-final">
                      <ShieldCheck size={20} />
                      <div>
                        <div className="title">Informational Only</div>
                        <p className="desc">No resource state modifications were recorded for this event.</p>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              <div className="drawer-footer-compact-fixed">
                <button className="btn btn-outline-final" onClick={() => setShowDetail(null)}>
                  Close Inspection
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        .page-header { margin-bottom: 24px; }
        
        .kpi-row { margin-bottom: 8px; }
        .summary-card-interactive { 
          background: var(--bg1); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; 
          padding: 14px 18px; display: flex; align-items: center; gap: 14px; cursor: pointer; transition: all 0.2s;
        }
        .summary-card-interactive:hover { transform: translateY(-2px); background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); }
        
        .audit-input-premium {
          width: 100%; padding: 10px 14px 10px 42px; background: rgba(0,0,0,0.2); 
          border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: #fff; font-size: 13px;
        }
        
        .filter-controls-row { display: flex; justify-content: space-between; align-items: center; }
        .dropdown-cluster { display: flex; gap: 10px; }
        .audit-select-compact { 
          background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(106, 228, 255, 0.45); 
          border-radius: 8px; padding: 6px 12px; color: #f8fafc; font-size: 12px; font-weight: 700; cursor: pointer;
        }
        .audit-select-compact:focus {
          outline: none;
          border-color: #6ae4ff;
          box-shadow: 0 0 0 2px rgba(106, 228, 255, 0.18);
        }
        .audit-select-compact option {
          background: #0f172a;
          color: #f8fafc;
        }
        
        .quick-chips-group { display: flex; align-items: center; gap: 8px; }
        .chip { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 4px 12px; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.5); cursor: pointer; transition: 0.2s; }
        .chip:hover { background: rgba(255,255,255,0.08); color: #fff; }
        .divider-v { width: 1px; height: 16px; background: rgba(255,255,255,0.1); margin: 0 4px; }
        
        .toggle-label { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); cursor: pointer; }
        .toggle-label input { cursor: pointer; }
        
        .audit-data-table-dense { width: 100%; border-collapse: separate; border-spacing: 0; }
        .audit-data-table-dense thead th { 
          padding: 10px 20px; text-align: left; font-size: 10.5px; font-weight: 800; color: rgba(255,255,255,0.4);
          text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid rgba(255,255,255,0.08);
          cursor: pointer;
        }
        .audit-data-table-dense tbody td { padding: 8px 20px; vertical-align: middle; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .audit-data-table-dense tbody tr:hover { background: rgba(255,255,255,0.015); }
        
        .row-group-header { background: rgba(106, 228, 255, 0.02); }
        .row-group-item { background: rgba(255,255,255,0.01); border-left: 2px solid rgba(106, 228, 255, 0.2); }
        
        .timestamp-stack-compact { display: flex; flex-direction: column; }
        .timestamp-stack-compact .date { font-size: 12px; font-weight: 700; color: #fff; }
        .timestamp-stack-compact .time { font-size: 10.5px; color: rgba(255,255,255,0.3); font-weight: 600; }
        
        .actor-cluster-compact { display: flex; align-items: center; gap: 10px; }
        .status-dot { width: 5px; height: 5px; border-radius: 50%; }
        .email { font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.7); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
        
        .op-cluster-compact { display: flex; flex-direction: column; gap: 2px; }
        .op-badge-pill { 
          display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 4px; 
          font-size: 9.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; width: fit-content;
        }
        .group-count-badge { background: rgba(0,0,0,0.3); color: #fff; padding: 1px 6px; border-radius: 4px; margin-left: 6px; font-size: 8.5px; }
        .op-description-text { margin: 0; font-size: 11.5px; color: rgba(255,255,255,0.4); line-height: 1.3; }
        
        .entity-ref-badge-premium { 
          display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px;
          font-size: 9px; font-weight: 900; cursor: pointer; transition: 0.2s; background: rgba(0,0,0,0.1);
        }
        .entity-ref-badge-premium:hover { background: rgba(255,255,255,0.05); transform: translateY(-1px); }
        .link-icon { opacity: 0.4; }
        .id-mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.3); }
        
        .btn-table-inspect { 
          display: flex; align-items: center; gap: 6px; background: rgba(106, 228, 255, 0.08); border: 1px solid rgba(106, 228, 255, 0.15);
          border-radius: 6px; padding: 4px 10px; color: var(--primary); font-size: 11.5px; font-weight: 700; cursor: pointer; transition: 0.2s;
        }
        .btn-table-inspect:hover { background: var(--primary); color: #000; }
        .btn-table-action { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; color: #fff; cursor: pointer; }
        
        /* Drawer Styles */
        .audit-drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.25); backdrop-filter: blur(8px); z-index: 5000; visibility: hidden; opacity: 0; transition: 0.3s; }
        .audit-drawer-overlay.visible { visibility: visible; opacity: 1; }
        .audit-drawer { position: fixed; top: 0; right: -520px; bottom: 0; width: 520px; background: #0f172a; box-shadow: -15px 0 50px rgba(0,0,0,0.5); z-index: 5001; transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1); display: flex; flex-direction: column; }
        .audit-drawer.open { right: 0; }
        
        .drawer-header-compact-fixed { padding: 18px 24px; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 10; }
        .drawer-type-icon { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        .drawer-title-final { margin: 0; font-size: 15px; font-weight: 900; color: #fff; text-transform: uppercase; letter-spacing: 0.04em; }
        .drawer-meta-final { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
        .cat { font-size: 9.5px; font-weight: 900; text-transform: uppercase; }
        .ts { font-size: 11.5px; color: rgba(255,255,255,0.3); }
        .btn-close-final { width: 26px; height: 26px; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        
        .drawer-body-compact-scroll { flex: 1; padding: 22px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 24px; }
        .drawer-section-final { display: flex; flex-direction: column; gap: 10px; }
        .section-heading-final { margin: 0; font-size: 10px; font-weight: 900; text-transform: uppercase; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; }
        
        .detail-grid-final { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .detail-box-final { padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; display: flex; flex-direction: column; gap: 4px; }
        .detail-box-final .label { font-size: 8.5px; font-weight: 900; color: rgba(255,255,255,0.2); text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
        .detail-box-final .value { font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,0.8); }
        .mono-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--primary); }
        
        .description-card-final { padding: 12px 16px; background: rgba(255,255,255,0.02); border-left: 2px solid var(--primary); border-radius: 4px 10px 10px 4px; display: flex; gap: 12px; }
        .description-card-final p { margin: 0; font-size: 12.5px; font-weight: 600; color: #fff; line-height: 1.4; }
        .info-icon { color: var(--primary); opacity: 0.5; margin-top: 1px; }
        
        .mutation-tag { font-size: 8.5px; font-weight: 900; background: rgba(255,209,102,0.1); color: #ffd166; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; }
        .transition-map-final { display: flex; flex-direction: column; gap: 8px; }
        .panel-map { background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.03); border-radius: 10px; overflow: hidden; }
        .panel-map.old { border-left: 3px solid #ff4d6d; }
        .panel-map.new { border-left: 3px solid #33d69f; }
        .panel-map .tag { background: rgba(255,255,255,0.02); padding: 3px 12px; font-size: 8.5px; font-weight: 900; color: rgba(255,255,255,0.2); border-bottom: 1px solid rgba(255,255,255,0.02); display: block; }
        .pre-wrap { max-height: 160px; overflow: auto; padding: 10px; }
        .pre-wrap pre { margin: 0; font-size: 10.5px; font-family: 'JetBrains Mono', monospace; color: #b9c0d4; white-space: pre-wrap; }
        
        .no-mutation-card-final { display: flex; align-items: center; gap: 14px; padding: 14px; background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.06); border-radius: 10px; color: rgba(255,255,255,0.3); }
        .no-mutation-card-final .title { font-size: 12.5px; font-weight: 800; color: rgba(255,255,255,0.6); }
        .no-mutation-card-final .desc { font-size: 10.5px; margin: 1px 0 0 0; }
        
        .drawer-footer-compact-fixed { padding: 14px 24px; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(12px); border-top: 1px solid rgba(255,255,255,0.05); position: sticky; bottom: 0; z-index: 10; }
        .btn-outline-final { width: 100%; background: transparent; border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); padding: 10px; border-radius: 8px; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .btn-outline-final:hover { background: rgba(255,255,255,0.05); color: #fff; border-color: rgba(255,255,255,0.2); }
        .audit-table-footer-premium { 
          padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; 
          background: rgba(0,0,0,0.1); border-top: 1px solid rgba(255,255,255,0.05);
        }
        .records-count { font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; display: flex; align-items: center; gap: 8px; }
        .dot-live { width: 6px; height: 6px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 10px var(--primary); animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
        
        .pagination-premium { display: flex; align-items: center; gap: 12px; }
        .btn-pagination-nav { 
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); 
          border-radius: 8px; padding: 6px 14px; color: rgba(255,255,255,0.6); font-size: 12px; 
          font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 8px;
        }
        .btn-pagination-nav:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #fff; border-color: var(--primary); }
        .btn-pagination-nav:disabled { opacity: 0.2; cursor: not-allowed; }
        
        .pagination-info { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; }
        .pagination-info .current { color: var(--primary); background: rgba(106, 228, 255, 0.1); padding: 4px 10px; border-radius: 6px; min-width: 60px; text-align: center; }
        .pagination-info .total { color: rgba(255,255,255,0.3); }
      `}</style>
    </div>
  );
}

function SummaryCard({ label, value, icon, color, onClick }) {
  return (
    <div className="summary-card-interactive" onClick={onClick}>
      <div className="summary-icon-box" style={{ background: `${color}12`, color }}>{icon}</div>
      <div>
        <div className="subtle" style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>{value}</div>
      </div>
    </div>
  );
}

function DetailBox({ label, value, icon, isMono }) {
  return (
    <div className="detail-box-final">
      <div className="label">{icon} {label}</div>
      <div className={`value ${isMono ? 'mono-val' : ''}`}>{value}</div>
    </div>
  );
}

function fmtDateCompact(iso) {
  const d = parseBackendDateTime(iso);
  if (!d) return "N/A";
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

function fmtTimeCompact(iso) {
  const d = parseBackendDateTime(iso);
  if (!d) return "N/A";
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function fmtFriendlyFull(iso) {
  return formatBackendDateTime(iso, {
    options: { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    fallback: 'N/A',
  });
}

function extractRecipientFromDescription(description) {
  if (!description || typeof description !== 'string') return null;
  const match = description.match(/confirmed by\s+(.+)$/i);
  if (!match) return null;
  const recipient = match[1].trim();
  return recipient || null;
}

function getAuditActor(log) {
  if (log?.user_email) {
    const email = log.user_email;
    return {
      label: email,
      tone: log.user_role === 'admin' ? 'admin' : 'user',
      key: `user:${email.toLowerCase()}`,
    };
  }

  const recipientName = extractRecipientFromDescription(log?.description);
  if (log?.action === 'DELIVERY_CONFIRMED' && recipientName) {
    return {
      label: `Recipient: ${recipientName}`,
      tone: 'user',
      key: `recipient:${recipientName.toLowerCase()}`,
    };
  }

  return {
    label: 'System Automation',
    tone: 'system',
    key: 'system',
  };
}

function formatFriendlyDesc(log) {
  const { action, description } = log;
  const actor = getAuditActor(log);
  if (action.includes('LOGIN') || action.includes('LOGOUT')) return `Authentication event recorded for ${actor.label}.`;
  if (action.includes('OVERRIDE')) return `Administrative override executed by ${actor.label}: ${description}.`;
  if (action === 'DELIVERY_CREATED') return `New delivery request created: ${description}.`;
  if (action.includes('CREATE')) return `New record created: ${description}.`;
  if (action.includes('UPDATE')) return `Resource state reconfiguration finalized: ${description}.`;
  if (action.includes('DELETE')) return `Asset decommissioned and removed: ${description}.`;
  return description;
}

function toReadableAuditKey(key) {
  const labels = {
    pickup: 'Pickup',
    dest: 'Destination',
    priority: 'Priority',
    package_type: 'Package Type',
    weight_kg: 'Weight',
  };

  if (labels[key]) return labels[key];

  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toReadableAuditState(value) {
  if (Array.isArray(value)) {
    return value.map(toReadableAuditState);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [k, v]) => {
      acc[toReadableAuditKey(k)] = toReadableAuditState(v);
      return acc;
    }, {});
  }

  return value;
}
