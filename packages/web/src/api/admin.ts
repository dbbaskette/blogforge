import { api } from "./client";

export interface AdminUser {
  id: string;
  email: string;
  status: "approved" | "pending" | "rejected" | "disabled";
  role: "user" | "admin";
  created_at: string;
  approved_at: string | null;
  last_login_at: string | null;
}

export const listUsers = (status?: AdminUser["status"]): Promise<AdminUser[]> =>
  api<AdminUser[]>(`/api/admin/users${status ? `?status=${status}` : ""}`);

export const approveUser = (id: string): Promise<AdminUser> =>
  api<AdminUser>(`/api/admin/users/${id}/approve`, { method: "POST" });

export const rejectUser = (id: string): Promise<AdminUser> =>
  api<AdminUser>(`/api/admin/users/${id}/reject`, { method: "POST" });

export const disableUser = (id: string): Promise<AdminUser> =>
  api<AdminUser>(`/api/admin/users/${id}/disable`, { method: "POST" });

export const promoteUser = (id: string): Promise<AdminUser> =>
  api<AdminUser>(`/api/admin/users/${id}/promote`, { method: "POST" });
