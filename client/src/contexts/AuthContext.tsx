import { createContext, useState, useEffect, ReactNode, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { fetchWithCsrf } from "../lib/queryClient";

export type UserRole = "admin" | "employer" | "clinician" | "insurer" | "partner";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  subrole: string | null;
  companyId: string | null;
  insurerId: string | null;
  /** How Alex addresses the user. Null when unset → fall back to email derivation. */
  preferredName?: string | null;
  organizationId?: string;
  // Partner-tier: the picked client org id when partner user has chosen one;
  // null for partner users who haven't picked yet; equal to organizationId
  // for non-partner users.
  activeOrganizationId?: string | null;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<boolean>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  const navigate = useNavigate();

  // Initialize auth by checking with server (cookie is sent automatically)
  useEffect(() => {
    initializeAuth();
  }, []);

  async function initializeAuth() {
    try {
      // Validate session by calling /api/auth/me
      // httpOnly cookie is sent automatically with credentials: 'include'
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const result = await response.json();
        setState({
          user: result.data.user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } else {
        // Not authenticated or session expired
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: response.status === 401 ? null : "Session check failed",
        });
      }
    } catch (error) {
      console.error("Auth initialization error:", error);
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: "Failed to restore session",
      });
    }
  }

  async function login(email: string, password: string) {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // Send/receive httpOnly cookies
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        const { user } = result.data;

        // Cookie is set automatically by server (httpOnly)
        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });

        // Navigate based on role: partner-role users go through the client
        // picker first; everyone else lands on their role-aware dashboard.
        if (user.role === "partner") {
          navigate("/partner/clients");
        } else {
          navigate("/");
        }
      } else {
        // Login failed
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: result.message || "Invalid email or password",
        }));
      }
    } catch (error) {
      console.error("Login error:", error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: "Network error. Please check your connection and try again.",
      }));
    }
  }

  async function logout() {
    try {
      // Call logout endpoint (cookie sent automatically, requires CSRF token)
      await fetchWithCsrf("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout error:", error);
      // Continue with local logout even if API call fails
    }

    // Clear local state (cookie is cleared by server)
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });

    // Navigate to login
    navigate("/login");
  }

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        // Refresh successful, get updated user data
        const meResponse = await fetch("/api/auth/me", {
          credentials: "include",
        });

        if (meResponse.ok) {
          const result = await meResponse.json();
          setState(prev => ({
            ...prev,
            user: result.data.user,
            isAuthenticated: true,
            error: null,
          }));
          return true;
        }
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    // Refresh failed, logout
    await logout();
    return false;
  }, [logout]);

  function clearError() {
    setState(prev => ({ ...prev, error: null }));
  }

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refreshAuth,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
