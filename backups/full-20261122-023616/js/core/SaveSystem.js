const KEY = 'restart_bounce_back_save_v1';

export const SaveSystem = {
  exists() {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  },
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return null;
      return data;
    } catch {
      return null;
    }
  },
  save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, version: 1, savedAt: Date.now() }));
      return true;
    } catch {
      return false;
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
