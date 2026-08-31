import assert from 'node:assert/strict';
import { readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import { openDatabase } from '../server/database.mjs';
import {
  createVoice,
  deleteVoice,
  getVoice,
  listVoices,
  parseSampleDataUrl,
  readFavoriteVoiceIds,
  readVoiceSample,
  updateVoice,
  writeFavoriteVoice,
} from '../server/voiceStore.mjs';
import { pcm16ToWav } from '../src/services/mimoClient.js';

async function createWavDataUrl(sampleValue = 0) {
  const wav = pcm16ToWav(new Uint8Array([sampleValue, 0, 64, 0]), 24000);
  return 'data:audio/wav;base64,' + Buffer.from(await wav.arrayBuffer()).toString('base64');
}

async function storedSampleFiles(storageDirectory) {
  const entries = await readdir(storageDirectory);
  return entries.filter((entry) => !entry.startsWith('.'));
}

test('本地音色创建、编辑、重启读取和删除会保持元数据与样本文件一致', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mimo-tts-voices-'));
  const databasePath = path.join(directory, 'voices.sqlite');
  const storageDirectory = path.join(directory, 'voices');
  let database;

  try {
    database = await openDatabase(databasePath);
    const design = await createVoice(database, storageDirectory, {
      kind: 'design',
      name: '深夜电台',
      voiceDescription: '温柔、清亮、语速稍慢。',
    });
    assert.equal(design.kind, 'design');
    assert.equal(design.voiceDescription, '温柔、清亮、语速稍慢。');

    const sampleDataUrl = await createWavDataUrl();
    const clone = await createVoice(database, storageDirectory, {
      kind: 'clone',
      name: '样本女声',
      sampleDataUrl,
      sampleFileName: '../sample.wav',
      sourceVoiceId: design.id,
    });
    assert.equal(clone.kind, 'clone');
    assert.equal(clone.sourceVoiceId, design.id);
    assert.equal(clone.sample.fileName, '.._sample.wav');
    assert.equal(clone.sample.available, true);
    assert.deepEqual((await readVoiceSample(database, storageDirectory, clone.id)).bytes, Buffer.from(sampleDataUrl.split(',')[1], 'base64'));
    assert.equal((await storedSampleFiles(storageDirectory)).length, 1);
    const initialSampleFile = database.prepare('SELECT sample_file FROM voices WHERE id = ?').get(clone.id).sample_file;
    await writeFile(path.join(storageDirectory, initialSampleFile), Buffer.from('damaged sample'));
    assert.equal((await getVoice(database, storageDirectory, clone.id)).sample.available, false);
    await assert.rejects(() => readVoiceSample(database, storageDirectory, clone.id), /样本文件已损坏/);

    writeFavoriteVoice(database, clone.id, true);
    const updatedDesign = await updateVoice(database, storageDirectory, design.id, {
      name: '深夜电台女声',
      voiceDescription: '温柔、清亮、语速稍慢，适合讲故事。',
    });
    assert.equal(updatedDesign.name, '深夜电台女声');
    assert.match(updatedDesign.voiceDescription, /讲故事/);
    await assert.rejects(() => updateVoice(database, storageDirectory, design.id, { kind: 'clone' }), /音色类型不能直接修改/);

    const updatedSampleDataUrl = await createWavDataUrl(32);
    await updateVoice(database, storageDirectory, clone.id, {
      name: '样本女声 2',
      sampleDataUrl: updatedSampleDataUrl,
      sampleFileName: 'replacement.wav',
    });
    assert.deepEqual((await storedSampleFiles(storageDirectory)).length, 1);

    database.close();
    database = undefined;
    database = await openDatabase(databasePath);
    const voicesAfterRestart = await listVoices(database, storageDirectory);
    assert.deepEqual(voicesAfterRestart.map((voice) => voice.name).sort(), ['深夜电台女声', '样本女声 2'].sort());
    assert.equal((await getVoice(database, storageDirectory, clone.id)).sourceVoiceId, design.id);
    assert.equal((await getVoice(database, storageDirectory, clone.id)).sample.available, true);
    assert.deepEqual(readFavoriteVoiceIds(database), [clone.id]);

    const cloneFile = database.prepare('SELECT sample_file FROM voices WHERE id = ?').get(clone.id).sample_file;
    await deleteVoice(database, storageDirectory, clone.id);
    await assert.rejects(() => stat(path.join(storageDirectory, cloneFile)), { code: 'ENOENT' });
    assert.equal((await listVoices(database, storageDirectory)).length, 1);
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('复刻样本校验 MIME、文件签名和 Base64 大小限制', async () => {
  const wavDataUrl = await createWavDataUrl();
  assert.equal(parseSampleDataUrl(wavDataUrl).extension, 'wav');
  assert.throws(() => parseSampleDataUrl('data:audio/mpeg;base64,' + Buffer.from('not an mp3').toString('base64')), /MP3 样本内容/);
  assert.throws(() => parseSampleDataUrl('data:audio/wav;base64,' + 'A'.repeat(10 * 1024 * 1024 + 4)), /Base64.*10 MB/);
});

test('数据库中的样本路径越界时会显式报错', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mimo-tts-voice-path-'));
  const databasePath = path.join(directory, 'voices.sqlite');
  const storageDirectory = path.join(directory, 'voices');
  let database;

  try {
    database = await openDatabase(databasePath);
    const clone = await createVoice(database, storageDirectory, {
      kind: 'clone',
      name: '路径测试',
      sampleDataUrl: await createWavDataUrl(),
    });
    database.prepare('UPDATE voices SET sample_file = ? WHERE id = ?').run('../outside.wav', clone.id);
    await assert.rejects(() => listVoices(database, storageDirectory), /音色样本路径无效/);
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
