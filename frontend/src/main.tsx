import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
// 沙盒拦截层：必须在 React 渲染前安装（否则首个 refresh 会打到真实后端）。
// 非沙盒模式下 installSandbox() 内部直接 return，不替换任何全局对象。
import { installSandbox } from './sandbox/mock-api.ts';

installSandbox();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
