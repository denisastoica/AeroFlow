import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authAPI, setOnUnauthorized, AUTH_CHANGED_EVENT } from "../services/api";

function notifyAuthChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

    const clearAuth = useCallback(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    setUser(null);
    setError(null);
    notifyAuthChanged();
  }, []);

    useEffect(() => {
    setOnUnauthorized(clearAuth);
    return () => setOnUnauthorized(null);
  }, [clearAuth]);

    useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const token = localStorage.getItem("access_token");

        const timeoutId = setTimeout(() => {
      setLoading(prev => {
        if (prev) console.warn("[Auth] Initialization timed out after 10s");
        return false;
      });
    }, 10000);

    if (storedUser && token) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
      } catch (_) {
        localStorage.removeItem("user");
        localStorage.removeItem("access_token");
      }

            authAPI
        .getProfile()
        .then((res) => {
                    const freshUser = res.data;
          localStorage.setItem("user", JSON.stringify(freshUser));
          setUser(freshUser);
        })
        .catch(() => {
                    localStorage.removeItem("access_token");
          localStorage.removeItem("user");
          setUser(null);
        })
        .finally(() => {
          clearTimeout(timeoutId);
          setLoading(false);
        });
    } else {
      clearTimeout(timeoutId);
      setLoading(false);
    }

    return () => clearTimeout(timeoutId);
  }, []);

  const register = async (email, password, name, phone, role = "customer") => {
    try {
      setError(null);
      const response = await authAPI.register({
        email,
        password,
        name,
        phone,
        role,
      });

      const { access_token, user: userData } = response.data;
      
      if (!access_token || !userData) {
        throw new Error("Invalid response format from server");
      }

      localStorage.setItem("access_token", access_token);
      localStorage.setItem("user", JSON.stringify(userData));
      setUser(userData);
      notifyAuthChanged();
      return userData;
    } catch (err) {
      const message = err.response?.data?.detail || err.message || "Registration failed";
      setError(message);
      throw new Error(message);
    }
  };

  const login = async (email, password) => {
    try {
      setError(null);
      const response = await authAPI.login({ email, password });
      const { access_token, user: userData } = response.data;
      
      if (!access_token || !userData) {
        throw new Error("Invalid response format from server");
      }

      localStorage.setItem("access_token", access_token);
      localStorage.setItem("user", JSON.stringify(userData));
      setUser(userData);
      notifyAuthChanged();
      return userData;
    } catch (err) {
      const message = err.response?.data?.detail || err.message || "Login failed";
      setError(message);
      throw new Error(message);
    }
  };

  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (_) {
          } finally {
      clearAuth();
    }
  };

  const value = {
    user,
    loading,
    error,
    register,
    login,
    logout,
    isAuthenticated: !!user,
    hasRole: (roles) => {
      if (!user) return false;
      const userRole = user.role?.toLowerCase();
      if (typeof roles === "string") return userRole === roles.toLowerCase();
      return roles.map(r => r.toLowerCase()).includes(userRole);
    },
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
