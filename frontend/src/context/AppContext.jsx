import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminKeyStore, API_BASE_URL } from '../api/apiClient.js';
import { healthApi } from '../api/index.js';

const AppContext = createContext(null);
const HEALTH_INTERVAL_MS = 30000;

/**
 * Genuinely shared state only: backend health (polled), non-sensitive system config, and the
 * admin key the operator entered for this tab session.
 */
export function AppProvider({ children }) {
  const [health, setHealth] = useState({ status: 'checking', data: null, error: null, checkedAt: null });
  const [config, setConfig] = useState(null);
  const [adminKey, setAdminKeyState] = useState(() => adminKeyStore.get());

  const checkHealth = useCallback(async (signal) => {
    try {
      const { data } = await healthApi.get({ signal });
      setHealth({ status: data.status === 'ok' ? 'online' : 'degraded', data, error: null, checkedAt: new Date() });
    } catch (err) {
      if (err.canceled) return;
      // 503 from /health still carries a body: the API is reachable but degraded.
      setHealth({
        status: err.status === 503 ? 'degraded' : 'offline',
        data: null,
        error: err,
        checkedAt: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkHealth(controller.signal);
    const t = setInterval(() => checkHealth(controller.signal), HEALTH_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(t);
    };
  }, [checkHealth]);

  const reloadConfig = useCallback(async () => {
    try {
      const { data } = await healthApi.systemConfig();
      setConfig(data);
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    if (health.status === 'online' || health.status === 'degraded') reloadConfig();
  }, [health.status, reloadConfig]);

  const setAdminKey = useCallback((value) => {
    adminKeyStore.set(value);
    setAdminKeyState(value);
  }, []);

  const value = useMemo(
    () => ({
      apiBaseUrl: API_BASE_URL,
      health,
      checkHealth,
      config,
      reloadConfig,
      adminKey,
      setAdminKey,
      hasAdminKey: Boolean(adminKey),
    }),
    [health, checkHealth, config, reloadConfig, adminKey, setAdminKey],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
