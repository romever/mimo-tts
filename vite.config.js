import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.MIMO_TTS_API_PORT || '8787';
const apiTarget = 'http://127.0.0.1:' + apiPort;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiTarget,
    },
  },
  preview: {
    proxy: {
      '/api': apiTarget,
    },
  },
});
