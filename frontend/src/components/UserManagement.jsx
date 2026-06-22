import React, { useState, useEffect, useCallback, useMemo } from "react";
import { 
  usersAPI, getErrorMessage, 
} from "../services/api";
import { useToast } from "../hooks/useToast";
import { Skeleton } from "./Skeleton";
import { formatBackendDateTime } from "../utils/datetime";
import { 
  UserPlus, Edit2, Trash2, Shield, 
  User as UserIcon, Search, Filter, 
  Mail, Clock, ShieldCheck,
  Power, Info, Users, UserCheck, UserX,
  Truck, ArrowUpRight, CheckCircle
} from "lucide-react";

const ROLE_CONFIG = {
  admin: { 
    label: "Administrator", 
    color: "#ff4d6d", 
    icon: <ShieldCheck size={14} />,
    desc: "Full platform control",
    initial: "A"
  },
  dispatcher: { 
    label: "Dispatcher", 
    color: "#6ae4ff", 
    icon: <ActivityIcon size={14} />,
    desc: "Fleet control & missions",
    initial: "D"
  },
  customer: { 
    label: "Customer", 
    color: "#33d69f", 
    icon: <UserIcon size={14} />,
    desc: "Requests & tracking",
    initial: "C"
  },
};

function ActivityIcon({ size }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>; }

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    phone: "",
    role: "customer",
    is_active: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showConfirm, setShowConfirm] = useState(null);
  const toast = useToast();

    const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch { return {}; }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await usersAPI.list();
      setUsers(res.data);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to load users"));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showModal]);

  const stats = useMemo(() => {
    return {
      total: users.length,
      active: users.filter(u => u.is_active).length,
      disabled: users.filter(u => !u.is_active).length,
      admins: users.filter(u => u.role === "admin").length
    };
  }, [users]);

  const handleOpenModal = (user = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        email: user.email,
        password: "", 
        name: user.name,
        phone: user.phone || "",
        role: user.role,
        is_active: user.is_active,
      });
    } else {
      setEditingUser(null);
      setFormData({
        email: "",
        password: "",
        name: "",
        phone: "",
        role: "customer",
        is_active: true,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (editingUser) {
        const activeAdmins = users.filter(u => u.role === "admin" && u.is_active);

                if (editingUser.id === currentUser.id && editingUser.role === "admin" && formData.role !== "admin") {
          toast.error("Safety Lock: You cannot remove your own administrative role.");
          return;
        }

                if (editingUser.id === currentUser.id && !formData.is_active) {
          toast.error("Safety Lock: You cannot deactivate your own administrative account.");
          return;
        }

                if (
          editingUser.role === "admin" &&
          editingUser.is_active &&
          activeAdmins.length <= 1 &&
          (formData.role !== "admin" || !formData.is_active)
        ) {
          toast.error("Safety Lock: At least one active Administrator must remain in the system.");
          return;
        }
        
        const updateData = { ...formData };
        if (!updateData.password) delete updateData.password;
        await usersAPI.update(editingUser.id, updateData);
        toast.success("User profile updated");
      } else {
        await usersAPI.create(formData);
        toast.success("User onboarded successfully");
      }
      fetchUsers();
      setShowModal(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save user"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmAction = async () => {
    if (!showConfirm) return;
    const { type, user } = showConfirm;
    
    try {
      if (type === 'delete') {
        await usersAPI.delete(user.id);
        toast.success("Identity purged from system");
      } else {
        await usersAPI.update(user.id, { is_active: !user.is_active });
        toast.success(`${user.name} is now ${user.is_active ? 'inactive' : 'active'}`);
      }
      fetchUsers();
    } catch (err) {
      toast.error(getErrorMessage(err, "Action restricted by system policy"));
    } finally {
      setShowConfirm(null);
    }
  };

  const handleToggleStatus = (user, e) => {
    e.stopPropagation();
    if (user.id === currentUser.id) {
      toast.error("Security Restriction: You cannot deactivate your own session.");
      return;
    }
    
    const activeAdmins = users.filter(u => u.role === "admin" && u.is_active);
    if (user.role === "admin" && user.is_active && activeAdmins.length <= 1) {
      toast.error("Safety Lock: At least one active Administrator must remain in the system.");
      return;
    }

    setShowConfirm({ type: 'toggle', user });
  };

  const handleDeleteUser = (user, e) => {
    e.stopPropagation();
    if (user.id === currentUser.id) {
      toast.error("Critical Failure: You cannot delete your own account while logged in.");
      return;
    }
    setShowConfirm({ type: 'delete', user });
  };

  const filteredUsers = users.filter(u => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    const matchesStatus = statusFilter === "all" || 
                         (statusFilter === "active" ? u.is_active : 
                         (statusFilter === "inactive" ? !u.is_active : 
                         (statusFilter === "never" ? !u.last_login : true)));
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="stack theme-admin">
      <header className="page-header">
        <div style={{ marginLeft: -24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Shield size={32} color="var(--primary)" style={{ flexShrink: 0, marginTop: 4 }} />
            <div>
              <h1 style={{ margin: 0 }}>User Management</h1>
              <p className="subtle" style={{ margin: 0, marginTop: 4 }}>Governance of system identities and access permissions.</p>
            </div>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UserPlus size={18} /> Create User
        </button>
      </header>

            <div className="grid grid-4" style={{ marginBottom: 24, gap: 16 }}>
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'rgba(106, 228, 255, 0.1)', color: 'var(--primary)', padding: 10, borderRadius: 12 }}><Users size={20} /></div>
          <div><div className="subtle" style={{ fontSize: 11, fontWeight: 700 }}>TOTAL USERS</div><div style={{ fontSize: 20, fontWeight: 800 }}>{stats.total}</div></div>
        </div>
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'rgba(51, 214, 159, 0.1)', color: '#33d69f', padding: 10, borderRadius: 12 }}><UserCheck size={20} /></div>
          <div><div className="subtle" style={{ fontSize: 11, fontWeight: 700 }}>ACTIVE</div><div style={{ fontSize: 20, fontWeight: 800 }}>{stats.active}</div></div>
        </div>
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'rgba(255, 77, 109, 0.1)', color: '#ff4d6d', padding: 10, borderRadius: 12 }}><UserX size={20} /></div>
          <div><div className="subtle" style={{ fontSize: 11, fontWeight: 700 }}>DISABLED</div><div style={{ fontSize: 20, fontWeight: 800 }}>{stats.disabled}</div></div>
        </div>
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', padding: 10, borderRadius: 12 }}><ShieldCheck size={20} /></div>
          <div><div className="subtle" style={{ fontSize: 11, fontWeight: 700 }}>ADMINS</div><div style={{ fontSize: 20, fontWeight: 800 }}>{stats.admins}</div></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body" style={{ display: "flex", gap: 16, alignItems: "center", padding: "12px 20px" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={16} className="subtle" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input 
              type="text" 
              placeholder="Search by name, email or role..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "100%", padding: "10px 12px 10px 40px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)", color: "#fff" }}
            />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: 'center' }}>
             <Filter size={14} className="subtle" />
             <select 
                className="select-input" 
                value={roleFilter} 
                onChange={(e) => setRoleFilter(e.target.value)}
                style={{ padding: '8px 12px', color: '#fff' }}
              >
                <option value="all">All Roles</option>
                <option value="admin">Administrators</option>
                <option value="dispatcher">Dispatchers</option>
                <option value="customer">Customers</option>
              </select>
              <select 
                className="select-input" 
                value={statusFilter} 
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: '8px 12px', color: '#fff' }}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Disabled Only</option>
                <option value="never">Never Logged In</option>
              </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card">
          <div className="card-body"><Skeleton count={6} height={60} style={{ marginBottom: 12 }} /></div>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>User Identity</th>
                <th>Access & Permissions</th>
                <th>Status</th>
                <th>Last Activity</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr 
                  key={user.id} 
                  onClick={() => handleOpenModal(user)} 
                  className="interactive-row"
                  style={{ opacity: user.is_active ? 1 : 0.6 }}
                >
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="user-avatar-role" style={{ background: ROLE_CONFIG[user.role]?.color + '15', color: ROLE_CONFIG[user.role]?.color }}>
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{user.name}</div>
                        <div className="subtle" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                          <Mail size={11} /> {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="role-badge" style={{ borderColor: ROLE_CONFIG[user.role]?.color + '44', background: ROLE_CONFIG[user.role]?.color + '11', color: ROLE_CONFIG[user.role]?.color }}>
                       {ROLE_CONFIG[user.role]?.icon}
                       {ROLE_CONFIG[user.role]?.label}
                    </div>
                    <div className="subtle" style={{ fontSize: 10, marginTop: 4, fontWeight: 500 }}>
                      {ROLE_CONFIG[user.role]?.desc}
                    </div>
                  </td>
                  <td>
                    <span className={`status-pill ${user.is_active ? 'active' : 'inactive'}`}>
                      {user.is_active ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                      <Clock size={13} className="subtle" />
                      {user.last_login ? fmtDateTime(user.last_login) : <span className="subtle" style={{ fontStyle: 'italic' }}>Never logged in</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                      <button className="icon-btn" title="Edit Profile" onClick={() => handleOpenModal(user)}>
                        <Edit2 size={14} />
                      </button>
                      <button 
                        className={`icon-btn ${user.is_active ? '' : 'success'}`} 
                        title={user.is_active ? "Disable Account" : "Enable Account"}
                        onClick={(e) => handleToggleStatus(user, e)}
                        disabled={user.id === currentUser.id}
                        style={{ opacity: user.id === currentUser.id ? 0.3 : 1 }}
                      >
                        {user.is_active ? <UserX size={14} /> : <Power size={14} />}
                      </button>
                      <button 
                        className="icon-btn danger" 
                        title="Delete Permanently" 
                        onClick={(e) => handleDeleteUser(user, e)}
                        disabled={user.id === currentUser.id}
                        style={{ opacity: user.id === currentUser.id ? 0.3 : 1 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center", padding: 80 }}>
                    <div className="subtle">
                       <Info size={48} style={{ opacity: 0.1, marginBottom: 16 }} />
                       <div>No identities found matching your criteria.</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="drawer-overlay" onClick={() => setShowModal(false)}>
          <div className="drawer-panel animate-slide-in" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="header-content">
                <h2 className="drawer-title">
                  {editingUser ? <Edit2 size={24} /> : <UserPlus size={24} />}
                  {editingUser ? "Edit User Profile" : "Onboard New Identity"}
                </h2>
                <p className="drawer-subtitle">
                  {editingUser ? "Modify account details and platform access levels." : "Create a new system user and assign system access."}
                </p>
              </div>
              <button className="drawer-close" onClick={() => setShowModal(false)} title="Close Panel">
                <span style={{ fontSize: 24 }}>&times;</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="drawer-body custom-scroll">
              <div className="form-section">
                <div className="section-header">
                  <label className="section-label">PERSONAL INFORMATION</label>
                  <div className="section-separator"></div>
                </div>
                <div className="form-group">
                  <label>Full Name</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    required
                    placeholder="e.g. Stoica Denisa"
                    className="drawer-input"
                  />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    required
                    placeholder="denisastoica@gmail.com"
                    disabled={editingUser}
                    className="drawer-input"
                  />
                </div>
              </div>

              <div className="form-section form-section--compact-top">
                <div className="section-header">
                  <label className="section-label">SECURITY & ACCESS</label>
                  <div className="section-separator"></div>
                </div>
                {!editingUser && (
                  <div className="form-group" style={{ marginBottom: 24 }}>
                    <label>Initial Password</label>
                    <input 
                      type="password" 
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      required={!editingUser}
                      className="drawer-input"
                    />
                    <div className="field-hint field-hint--password" aria-live="polite">
                      Must include: at least 8 characters, one uppercase letter, one lowercase letter, and one number.
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label style={{ marginBottom: 20, display: 'block' }}>Platform Access Role</label>
                  <div className="role-grid">
                    {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                      <div 
                        key={role} 
                        className={`role-item-v2 ${formData.role === role ? 'active' : ''}`}
                        onClick={() => setFormData({...formData, role})}
                      >
                        <div className="role-main">
                          <div className="role-icon-box" style={{ background: config.color + (formData.role === role ? '25' : '10'), color: config.color }}>
                            {config.icon}
                          </div>
                          <div className="role-text">
                            <div className="role-name-v2">{config.label}</div>
                            <div className="role-desc-v2">{config.desc}</div>
                          </div>
                        </div>
                        {formData.role === role && (
                          <div className="role-check" style={{ color: config.color }}>
                            <CheckCircle size={18} fill="currentColor" fillOpacity="0.15" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="form-section form-section--tight-top">
                <div className="section-header">
                  <label className="section-label">ACCOUNT GOVERNANCE</label>
                  <div className="section-separator"></div>
                </div>
                <div className="governance-card">
                  <label className="governance-label">
                    <div className="checkbox-wrapper">
                      <input 
                        type="checkbox" 
                        checked={formData.is_active}
                        onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                        disabled={editingUser?.id === currentUser.id}
                      />
                    </div>
                    <div className="governance-text">
                      <div className="gov-title">Account is Active</div>
                      <div className="gov-desc">Allow this user to sign in and access their assigned dashboard.</div>
                    </div>
                  </label>
                </div>
              </div>
            </form>

            <div className="drawer-footer-anchored">
              <button type="button" className="btn btn-drawer-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Processing..." : (editingUser ? "Save Profile" : "Create User")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(null)}>
          <div className="modal-content animate-pop" style={{ maxWidth: 400, padding: 32, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ 
              width: 64, height: 64, borderRadius: '50%', background: showConfirm.type === 'delete' ? 'rgba(255,77,109,0.1)' : 'rgba(255,209,102,0.1)',
              color: showConfirm.type === 'delete' ? '#ff4d6d' : '#ffd166',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto'
            }}>
              {showConfirm.type === 'delete' ? <Trash2 size={32} /> : <Power size={32} />}
            </div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 20 }}>
              {showConfirm.type === 'delete' ? 'Delete Identity?' : (showConfirm.user.is_active ? 'Disable Account?' : 'Enable Account?')}
            </h3>
            <p className="subtle" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
              {showConfirm.type === 'delete' 
                ? `You are about to permanently purge ${showConfirm.user.name} from the system. This action cannot be undone.`
                : `Are you sure you want to ${showConfirm.user.is_active ? 'suspend' : 'restore'} access for ${showConfirm.user.name}?`}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setShowConfirm(null)}>Cancel</button>
              <button 
                className={`btn ${showConfirm.type === 'delete' ? 'btn-danger' : 'btn-primary'}`} 
                style={{ flex: 1 }} 
                onClick={confirmAction}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .interactive-row { cursor: pointer; transition: background 0.2s; }
        .interactive-row:hover { background: rgba(255,255,255,0.02); }
        .user-avatar-role {
          width: 36px; height: 36px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 16px; border: 1px solid rgba(255,255,255,0.05);
        }
        .role-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 800;
          border: 1px solid transparent; text-transform: uppercase; letter-spacing: 0.3px;
        }
        .status-pill {
          padding: 3px 8px; border-radius: 4px; font-size: 9px; font-weight: 900; letter-spacing: 0.5px;
        }
        .status-pill.active { background: rgba(51, 214, 159, 0.15); color: #33d69f; }
        .status-pill.inactive { background: rgba(255, 77, 109, 0.1); color: #ff4d6d; }
        
        .icon-btn {
          width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);
          background: rgba(255,255,255,0.02); color: rgba(255,255,255,0.4);
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          transition: all 0.2s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .icon-btn.danger:hover { background: #ff4d6d; color: #fff; border-color: #ff4d6d; }
        .icon-btn.success:hover { background: #33d69f; color: #fff; border-color: #33d69f; }
        
        /* High-Fidelity Drawer Styles */
        .drawer-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.3); backdrop-filter: blur(3px);
          display: flex; justify-content: flex-end; z-index: 2000;
        }
        .drawer-panel {
          width: 100%; max-width: 560px; height: 100vh;
          background: #0b0f1a; border-left: 1px solid rgba(255,255,255,0.08);
          display: flex; flex-direction: column; box-shadow: -20px 0 60px rgba(0,0,0,0.6);
        }
        .drawer-header {
          padding: 30px 32px 22px 32px; border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex; justify-content: space-between; align-items: center;
          background: linear-gradient(to bottom, rgba(106, 228, 255, 0.03), transparent);
        }
        .drawer-title { display: flex; align-items: center; gap: 14px; margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -0.5px; }
        .drawer-subtitle { margin: 8px 0 0 0; font-size: 13px; color: rgba(255,255,255,0.45); font-weight: 500; }
        .drawer-close {
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); 
          color: rgba(255,255,255,0.3); width: 34px; height: 34px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          transition: all 0.2s; font-size: 20px;
        }
        .drawer-close:hover { background: rgba(255,77,109,0.1); color: #ff4d6d; border-color: rgba(255,77,109,0.2); }
        
        .drawer-body { flex: 1; overflow-y: auto; padding: 28px 32px; display: flex; flex-direction: column; gap: 28px; }
        .form-section { display: flex; flex-direction: column; gap: 16px; }
        .form-section--compact-top { margin-top: 2px; }
        .form-section--tight-top { margin-top: 8px; }
        .section-header { margin-bottom: 2px; }
        .section-label { font-size: 10px; font-weight: 900; color: var(--primary); letter-spacing: 2.5px; opacity: 0.8; }
        .section-separator { height: 1px; background: linear-gradient(to right, rgba(106, 228, 255, 0.15), transparent); margin-top: 6px; }
        
        .form-group label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.7); }
        
        .drawer-input {
          width: 100%; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.01); color: #fff; transition: all 0.2s; font-size: 14px;
        }
        .drawer-input:focus { border-color: var(--primary); box-shadow: 0 0 0 4px rgba(106, 228, 255, 0.08); outline: none; background: rgba(0,0,0,0.2); }
        .drawer-input::placeholder { color: rgba(255,255,255,0.12); }
        .field-hint {
          margin-top: 7px;
          font-size: 11px;
          line-height: 1.45;
          color: rgba(255,255,255,0.42);
        }
        .field-hint--password {
          background: rgba(106, 228, 255, 0.04);
          border: 1px solid rgba(106, 228, 255, 0.12);
          border-radius: 10px;
          padding: 8px 10px;
        }
        
        /* Role Selection V2 */
        .role-grid { display: flex; flex-direction: column; gap: 10px; }
        .role-item-v2 {
          display: flex; justify-content: space-between; align-items: center;
          padding: 14px 16px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.05);
          background: rgba(255,255,255,0.01); cursor: pointer; transition: all 0.2s;
        }
        .role-item-v2:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.1); }
        .role-item-v2.active { border-color: var(--primary); background: rgba(106, 228, 255, 0.05); box-shadow: 0 0 25px rgba(106, 228, 255, 0.08); }
        .role-main { display: flex; align-items: center; gap: 12px; }
        .role-icon-box { 
          width: 38px; height: 38px; border-radius: 10px; 
          display: flex; align-items: center; justify-content: center; 
          transition: all 0.2s; flex-shrink: 0;
        }
        .role-icon-box svg { display: block; }
        .role-name-v2 { font-size: 14px; font-weight: 700; color: #fff; }
        .role-desc-v2 { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 3px; line-height: 1.35; }
        .role-check { display: flex; align-items: center; opacity: 0; transition: all 0.2s; transform: scale(0.8); }
        .role-item-v2.active .role-check { opacity: 1; transform: scale(1); }
        
        .governance-card {
          background: rgba(255,255,255,0.015); padding: 16px; border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.04);
        }
        .governance-label { display: flex; align-items: flex-start; gap: 16px; cursor: pointer; margin: 0; }
        .governance-text { flex: 1; }
        .gov-title { font-weight: 700; font-size: 14px; color: #fff; }
        .gov-desc { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 3px; line-height: 1.4; }
        
        .drawer-footer-anchored {
          padding: 16px 32px; background: rgba(11, 15, 26, 0.95); backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255,255,255,0.1); display: flex; gap: 18px;
          position: sticky; bottom: 0; margin-top: auto; z-index: 10;
        }
        .btn-drawer-secondary { 
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); 
          color: rgba(255,255,255,0.65); padding: 0 26px; height: 46px; font-size: 14px; font-weight: 600;
          display: flex; align-items: center; justify-content: center; border-radius: 12px; transition: all 0.2s;
        }
        .btn-drawer-secondary:hover { background: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.2); }
        
        .drawer-panel .btn-primary { height: 46px; font-size: 14px; font-weight: 700; padding: 0 30px; border-radius: 12px; }
        
        .custom-scroll::-webkit-scrollbar { width: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.03); border-radius: 10px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.08); }
        
        .select-input {
          background: #0f172a;
          color: #ffffff;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          cursor: pointer;
          outline: none;
        }
        .select-input option {
          background: #0b0f1a;
          color: #ffffff;
        }
        
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; z-index: 3000;
        }
        .modal-content {
          background: #0f172a; border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          width: 100%; max-width: 400px; padding: 40px;
        }
        .animate-pop { animation: modalPop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes modalPop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        .animate-slide-in { animation: slideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </div>
  );
}

function fmtDateTime(iso) {
  if (!iso || iso === "null") return "Never logged in";
  return formatBackendDateTime(iso, {
    options: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true },
    fallback: 'Never logged in',
  });
}
