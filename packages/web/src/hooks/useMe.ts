import { useCallback, useEffect, useState } from "react";

import { type CurrentUser, getMe } from "../api/auth";

export interface UseMeResult {
  user: CurrentUser | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useMe(): UseMeResult {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    getMe()
      .then((u) => {
        setUser(u);
        setError(null);
      })
      .catch((e: Error) => {
        setUser(null);
        setError(e);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { user, loading, error, refresh };
}
