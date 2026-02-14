import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// This config is for standalone web development
// For Electron development, see electron.vite.config.ts
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
