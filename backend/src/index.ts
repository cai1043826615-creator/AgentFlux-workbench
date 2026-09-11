import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { seed } from './db/seed.ts';
import { installSmartProducer } from './agents/smart-producer.ts';
import { installAnnouncer } from './agents/announcer.ts';
import { chatRoutes } from './routes/chat.ts';
import { taskRoutes } from './routes/tasks.ts';
import { workflowRoutes } from './routes/workflows.ts';
import { settingsRoutes } from './routes/settings.ts';
import { agentRoutes } from './routes/agents.ts';
import { executionRoutes } from './routes/executions.ts';
import { knowledgeRoutes } from './routes/knowledge.ts';
import { ensureKnowledgeSchema } from './knowledge/schema.ts';
import { rebuildIndexInBackground } from './knowledge/indexer.ts';
import { resolveVaultConfig } from './knowledge/vault.ts';
import { addClient, handleWsClientMessage, wireBroadcast } from './ws/broadcast.ts';

const PORT = Number(process.env.PORT ?? 4311);
const HOST = process.env.HOST ?? '127.0.0.1';

async function buildApp(): Promise<FastifyInstance> {
  // bodyLimit 调大：参考图上传 dataURL 可能数 MB，默认 1MB 会 413
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

  await app.register(websocket);

  // 健康检查
  app.get('/health', async () => ({ status: 'ok', service: 'workbench-backend', ts: Date.now() }));

  // WS 端点：心跳 + 全量广播（任务/事件/聊天/工位/审批）
  app.get('/ws', { websocket: true }, (socket) => {
    addClient(socket);
    socket.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'ping') socket.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
        else handleWsClientMessage(msg);
      } catch {
        /* ignore malformed */
      }
    });
  });

  // REST 路由
  await app.register(chatRoutes);
  await app.register(taskRoutes);
  await app.register(workflowRoutes);
  await app.register(settingsRoutes);
  await app.register(agentRoutes);
  await app.register(executionRoutes);
  await app.register(knowledgeRoutes);

  // 引擎事件 → WS 广播
  wireBroadcast();

  return app;
}

async function main(): Promise<void> {
  seed();
  installAnnouncer(); // 引擎事件 → 工作群中文播报
  installSmartProducer();
  // 板块 B：知识库表保底建立；已配置 Vault 时后台重建索引（异步，不阻塞启动与板块 A）
  ensureKnowledgeSchema();
  if (resolveVaultConfig().root) {
    rebuildIndexInBackground();
    console.log('[workbench] 知识库：检测到 Vault 配置，已触发后台重建索引');
  }
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  console.log(`[workbench] backend ready at http://${HOST}:${PORT}`);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('[workbench] startup failed', err);
    process.exit(1);
  });
}

export { buildApp, main };
