import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useMe } from "../hooks/useMe";

interface RequireAuthProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function RequireAuth({ children, requireAdmin = false }: RequireAuthProps): JSX.Element {
  const { user, loading, error } = useMe();

  if (loading) {
    return <p className="text-center text-muted text-sm py-16">Checking session…</p>;
  }

  if (error || !user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
