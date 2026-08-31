import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_API_ENDPOINT, openDatabase, readApiSettings, writeApiSettings } from '../server/database.mjs';

test('API 配置写入 SQLite 后，重新打开数据库仍能读取', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mimo-tts-settings-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  let database;

  try {
    database = await openDatabase(databasePath);
    assert.deepEqual(readApiSettings(database), { endpoint: DEFAULT_API_ENDPOINT, apiKey: '' });

    writeApiSettings(database, {
      endpoint: 'https://example.com/v1',
      apiKey: 'sk-test-persistent',
    });
    database.close();
    database = undefined;

    database = await openDatabase(databasePath);
    assert.deepEqual(readApiSettings(database), {
      endpoint: 'https://example.com/v1',
      apiKey: 'sk-test-persistent',
    });
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
