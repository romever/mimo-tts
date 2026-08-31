import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const apiPort = process.env.MIMO_TTS_API_PORT || '8787';
const apiEntry = fileURLToPath(new URL('./api.mjs', import.meta.url));
const viteEntry = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const childEnvironment = { ...process.env, MIMO_TTS_API_PORT: apiPort };

const apiProcess = spawn(process.execPath, [apiEntry], {
  env: childEnvironment,
  stdio: 'inherit',
});

async function waitForApi() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (apiProcess.exitCode !== null) {
      throw new Error('本地配置服务提前退出，无法启动开发环境');
    }
    try {
      const response = await fetch('http://127.0.0.1:' + apiPort + '/api/health');
      if (response.ok) return;
    } catch {
      // 本地服务启动期间连接被拒绝是正常的，继续等待服务就绪。
    }
    await delay(100);
  }
  throw new Error('等待本地配置服务超时');
}

function stopProcess(child) {
  if (!child) return;
  if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopProcess(apiProcess);
  stopProcess(viteProcess);
}

let viteProcess;
try {
  await waitForApi();
  viteProcess = spawn(process.execPath, [viteEntry], {
    env: childEnvironment,
    stdio: 'inherit',
  });

  apiProcess.once('exit', (code) => {
    if (shuttingDown) return;
    process.exitCode = 1;
    console.error('本地配置服务已退出（代码：' + code + '）');
    shutdown();
  });
  viteProcess.once('exit', (code) => {
    if (shuttingDown) return;
    process.exitCode = 1;
    console.error('前端开发服务已退出（代码：' + code + '）');
    shutdown();
  });
} catch (error) {
  console.error(error.message);
  shutdown();
  process.exitCode = 1;
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
