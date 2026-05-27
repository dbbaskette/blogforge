import { api } from "./client";

export interface CurrentUser {
  id: string;
  email: string;
  role: "user" | "admin";
  status: "approved" | "pending" | "rejected" | "disabled";
}

export const getMe = (): Promise<CurrentUser> => api<CurrentUser>("/api/auth/me");

export const login = (email: string, password: string): Promise<{ status: string }> =>
  api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const logout = (): Promise<void> => api("/api/auth/logout", { method: "POST" });

export const requestAccess = (email: string, password: string): Promise<{ status: string }> =>
  api("/api/auth/request", { method: "POST", body: JSON.stringify({ email, password }) });
