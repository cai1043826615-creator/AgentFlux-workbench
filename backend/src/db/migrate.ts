import { ensureSchema } from './ensure.ts';

// 轻量数据层：幂等建表（无独立迁移框架依赖）
ensureSchema();
console.log('[db] schema ready');
