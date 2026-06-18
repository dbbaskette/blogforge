import { api } from "./client";

export interface CurrentUser {
  id: string;
  email: string | null;
  github_login: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  status: "approved" | "pending" | "rejected" | "disabled";
  last_login_at: string | null;
}

export const getMe = (): Promise<CurrentUser> => api<CurrentUser>("/api/auth/me");
export const logout = (): Promise<void> => api("/api/auth/logout", { method: "POST" });
export const revokeAllSessions = (): Promise<void> =>
  api("/api/auth/sessions/revoke-all", { method: "POST" });
