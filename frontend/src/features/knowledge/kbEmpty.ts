/**
 * 知识域空态文案（knowledge-ux A5）：统一 8 类场景的「说明 + 下一步」与可断言标识。
 *
 * 设计（design.md D9 / tasks 4.2）：
 * - 每个场景 = 说明文案（渲染在 data-qs-empty="<key>" 节点）+ 下一步指引（渲染在 data-qs-empty-next="<key>" 节点）。
 * - 集中声明在本文件：知识库页、星图、热点、关联资料步骤共用，避免同场景文案散落各处。
 * - 「星图无数据」同时被主视图与总览带缩略预览复用（tasks 4.4：同一文案来源）。
 */
export interface KbEmptyState {
  /** 场景标识（data-qs-empty / data-qs-empty-next 的值） */
  key: string;
  /** 说明「这里是什么」 */
  text: string;
  /** 下一步「该做什么」 */
  hint: string;
}

/** 8 类知识域空态（tasks 4.2 清单；文案与 tasks 4.3–4.7 逐条对应） */
export const KB_EMPTY_STATES = {
  /** 知识库未连接（保留既有实现 + 补下一步） */
  kbDisconnected: {
    key: 'kb-disconnected',
    text: '未连接 Obsidian Vault',
    hint: '去连接 Obsidian Vault；知识库独立于工作流，未连接时「多 Agent 工作流」全部功能照常可用。',
  },
  /** 已连接但无文档 */
  kbNoDocs: {
    key: 'kb-no-docs',
    text: '知识库当前没有索引到任何 Markdown 文档',
    hint: '检查 Vault 路径与索引范围，或在 Vault 中新建 .md 后点「重建索引」。',
  },
  /** 阅读区未选文档（意见 N6：空态承担「引导下一步」职责，不再只写一行「从左侧选择」） */
  kbNoDocSelected: {
    key: 'kb-no-doc-selected',
    text: '从左侧选一篇文档开始阅读',
    hint: '也可以直接用上方搜索框找文档或标签；下面是从最近更新与每日热点出发的快捷入口。',
  },
  /** 无标签 */
  kbNoTags: {
    key: 'kb-no-tags',
    text: '暂无文档声明标签',
    hint: '在文档 frontmatter 的 tags 字段写标签，保存后点「重建索引」；标签是知识星图连通与检索的关键。',
  },
  /** 无目录 */
  kbNoDirs: {
    key: 'kb-no-dirs',
    text: '暂无目录层级',
    hint: '把资料整理进子目录，如「原始资料/产品资料」，再点「重建索引」，目录会成为浏览与过滤入口。',
  },
  /** 星图无数据（无链接且无标签；主视图与缩略预览同一文案来源） */
  graphEmpty: {
    key: 'graph-empty',
    text: '暂无图谱关系',
    hint: '在文档之间添加 [[wiki链接]]，或让两篇文档共享同一标签，然后点「刷新」。',
  },
  /** 搜索结果为空 */
  searchEmpty: {
    key: 'search-empty',
    text: '当前关键词没有命中任何已索引文档',
    hint: '换用 ≥2 字的中文关键词、或清除搜索回到目录/标签浏览；若确认文档应在索引内，检查索引范围。',
  },
  /** 热点不可用（unavailable） */
  hotEmptyUnavailable: {
    key: 'hot-empty',
    text: '上游热点源暂不可用',
    hint: '点「刷新」重试、或检查关注域配置；不影响知识库其他功能与工作流板块。',
  },
  /** 热点无条目（上游 0 条） */
  hotEmptyNone: {
    key: 'hot-empty',
    text: '本次未取到热点条目',
    hint: '点「刷新」重试、或检查关注域配置；不影响知识库其他功能与工作流板块。',
  },
  /** 「关联知识库资料」步骤无搜索结果 */
  kbRefSearchEmpty: {
    key: 'kb-ref-search-empty',
    text: '当前关键词没有命中知识库资料',
    hint: '换关键词重试，或直接跳过本步骤创建任务，之后再回来关联；知识库未连接时提示先连接 Vault。',
  },
  /** 孤岛筛选结果为空（孤岛数为 0 时点击孤岛指标） */
  noIslands: {
    key: 'no-islands',
    text: '没有孤岛文件',
    hint: '所有已索引文档都至少有文档间链接或共享标签；孤岛 = Agent 永远检索不到的资料。',
  },
} as const satisfies Record<string, KbEmptyState>;

export type KbEmptyKey = keyof typeof KB_EMPTY_STATES;
