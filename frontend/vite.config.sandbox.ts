/**
 * 沙盒版构建配置（作品集用）
 *
 * 用途：把工作台前端构建成**纯静态、可独立部署**的沙盒体验版，
 *       产物放到作品集站点的 sandbox/ 子目录下，通过「即刻体验」按钮进入。
 *
 * 与 vite.config.ts 的差异（只有三点，都很关键）：
 * 1. `base: './'` —— 资源用**相对路径**引用。因为沙盒会挂在 /sandbox/ 子路径下，
 *    如果用默认的绝对路径 `/assets/xxx.js`，部署后会 404。
 * 2. `outDir` 指向作品集站点的 sandbox 目录（可读环境变量覆盖，便于本地验证）。
 * 3. 构建时注入 `VITE_SANDBOX=1`，让前端启用「拦截层 + 新手引导」，不连后端、不调真实 AI。
 *
 * 用法：
 *   cd frontend
 *   .\node_modules\.bin\vite.cmd build --config vite.config.sandbox.ts
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

/** 作品集站点里沙盒的落点（可用 SANDBOX_OUT 环境变量覆盖，默认指向本地 sandbox-dist） */
const outDir = process.env.SANDBOX_OUT
  ? resolve(process.env.SANDBOX_OUT)
  : resolve(import.meta.dirname, '../sandbox-dist');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 相对路径引用资源，保证挂在任意子路径下都能正确加载
  base: './',
  define: {
    // 让前端识别当前是沙盒构建（拦截层与新手引导据此启用）
    'import.meta.env.VITE_SANDBOX': JSON.stringify('1'),
  },
  build: {
    outDir,
    emptyOutDir: true,
    // 沙盒是静态托管，不做 sourcemap 暴露源码结构
    sourcemap: false,
    // 单页应用资源不大，放宽告警阈值避免噪音
    chunkSizeWarningLimit: 800,
  },
});
