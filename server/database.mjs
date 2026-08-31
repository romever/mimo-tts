import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_API_ENDPOINT = 'https://api.xiaomimimo.com/v1';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = path.resolve(serverDirectory, '../data/mimo-tts.sqlite');

export function resolveDatabasePath() {
  const configuredPath = process.env.MIMO_TTS_DB_PATH?.trim();
  return configuredPath ? path.resolve(configuredPath) : defaultDatabasePath;
}

export async function openDatabase(databasePath = resolveDatabasePath()) {
  if (databasePath === ':memory:') {
    throw new Error('MIMO_TTS_DB_PATH 必须指向可持久化的 SQLite 文件');
  }
  await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath);
  await chmod(databasePath, 0o600);
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return database;
}

function readSetting(database, key) {
  return database.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

export function readApiSettings(database) {
  return {
    endpoint: readSetting(database, 'api.endpoint') ?? DEFAULT_API_ENDPOINT,
    apiKey: readSetting(database, 'api.apiKey') ?? '',
  };
}

export function writeApiSettings(database, { endpoint, apiKey }) {
  if (typeof endpoint !== 'string' || typeof apiKey !== 'string') {
    throw new TypeError('API 配置必须包含字符串类型的 endpoint 和 apiKey');
  }

  const saveSetting = database.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  const updatedAt = new Date().toISOString();

  database.exec('BEGIN IMMEDIATE');
  try {
    saveSetting.run('api.endpoint', endpoint, updatedAt);
    saveSetting.run('api.apiKey', apiKey, updatedAt);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
