import { api } from "./client";

export interface CurrentUser {
  id: string;
  email: string;
  role: "user" | "admin";
  status: "approved" | "pending" | "rejected" | "disabled";
  last_login_at: string | null;
}

export const getMe = (): Promise<CurrentUser> => api<CurrentUser>("/api/auth/me");

export const login = (email: string, password: string): Promise<{ status: string }> =>
  api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const logout = (): Promise<void> => api("/api/auth/logout", { method: "POST" });

export const requestAccess = (email: string, password: string): Promise<{ status: string }> =>
  api("/api/auth/request", { method: "POST", body: JSON.stringify({ email, password }) });

export const changePassword = (
  oldPassword: string,
  newPassword: string,
): Promise<{ status: string }> =>
  api("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });

export const revokeAllSessions = (): Promise<void> =>
  api("/api/auth/sessions/revoke-all", { method: "POST" });
