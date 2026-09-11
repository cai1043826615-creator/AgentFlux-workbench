import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4310,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4312',
      '/ws': { target: 'ws://127.0.0.1:4312', ws: true },
      '/health': 'http://127.0.0.1:4312',
      '/uploads': 'http://127.0.0.1:4312',
    },
    // 忽略编辑器/工具产生的临时文件与静态资源目录，避免 watch EBUSY 崩溃
    watch: {
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.tmp-*', '**/.tmp-board.png', '**/dist/**', '**/public/**', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.webp'],
    },
  },
});
