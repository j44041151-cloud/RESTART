const KEY = 'restart_bounce_back_save_v1';
const VERSION = 2;

/**
 * Save slots.
 *
 * v1 (the original three-mission build) is migrated on load: mission index 0/1
 * map to chapters 1/2, and an old Core save maps to chapter 5. Nothing the
 * player restored is thrown away.
 */
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
      if (!data || (data.version !== 1 && data.version !== VERSION)) return null;
      if (data.version === 1) {
        const legacy = data.mission?.index ?? 0;
        const chapter = legacy >= 2 ? 4 : legacy;
        data.chapter = chapter;
        data.legacy = true;
        data.completed = !!data.completed;
        data.memories = [];
        if (data.mission) data.mission.index = chapter;
        data.version = VERSION;
      }
      return data;
    } catch {
      return null;
    }
  },
  save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, version: VERSION, savedAt: Date.now() }));
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
