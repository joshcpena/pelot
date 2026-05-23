type SettingRow = {
  key: string;
  value: string;
};

type WebDatabase = {
  execAsync: (sql: string) => Promise<void>;
  getAllAsync: <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
  runAsync: (sql: string, ...params: unknown[]) => Promise<void>;
};

const SETTINGS_STORAGE_KEY = 'pelot.settings';

function readSettingsRows(): SettingRow[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!storedSettings) {
    return [];
  }

  return Object.entries(
    JSON.parse(storedSettings) as Record<string, string>,
  ).map(([key, value]) => ({ key, value }));
}

function writeSetting(key: string, value: string) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const rows = readSettingsRows();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  settings[key] = value;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function deleteSetting(key: string) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const rows = readSettingsRows();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  delete settings[key];
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

const webDatabase: WebDatabase = {
  async execAsync() {},
  async getAllAsync<T>(sql: string, ...params: unknown[]) {
    if (sql.includes('settings') && sql.includes('WHERE key') && params[0]) {
      return readSettingsRows().filter((row) => row.key === params[0]) as T[];
    }

    if (!sql.includes('settings')) {
      return [];
    }

    return readSettingsRows() as T[];
  },
  async runAsync(sql, ...params) {
    if (sql.includes('DELETE FROM settings') && params[0]) {
      deleteSetting(String(params[0]));
      return;
    }

    if (sql.includes('settings') && params.length >= 2) {
      writeSetting(String(params[0]), String(params[1]));
    }
  },
};

export async function getDatabase() {
  return webDatabase;
}

export async function initializeDatabase() {}
