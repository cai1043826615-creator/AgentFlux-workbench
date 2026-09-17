## MODIFIED Requirements

### Requirement: 事实项抽取

**生图交付物落地为文件**：图片类交付物不再以 base64 dataURL 全量存入 `deliverables.content`（单张 2.4MB），改为写入 `backend/data/uploads/<uuid>.png`，content 存相对路径 `/uploads/<file>`（复用既有 `/uploads/:file` 静态路由，修 D-03 体积问题）。存量 base64 内容由**一次性迁移**落盘并写 settings 标记（不写成启动常驻迁移，遵循架构铁律 11）。

#### Scenario: 生图结果存文件

- **WHEN** 生图阶段产出图片交付物
- **THEN** 图片文件落在 `backend/data/uploads/`，接口返回相对路径而非数 MB base64

#### Scenario: 存量 base64 迁移

- **WHEN** 一次性迁移执行后
- **THEN** 旧 base64 交付物已落盘为文件，`deliverables.content` 存路径，settings 记录迁移标记

### Requirement: 产出溯源标记

交付物搜索（`GET /api/deliverables/search`）SHALL 走元信息而非全表扫描：新增 `deliverable_images(deliverable_id, image_id, name, status, url)` 索引表，搜索按该表 LIKE 匹配图片名（修 D-04）；文案类搜索 SHALL 以 `WHERE kind='copy'` 缩小范围。列表接口 SHALL 为 `deliverables(task_id, updated_at)`、`task_events(task_id, created_at)` 建复合索引，`UPDATED_AT_EXPR` 改 LEFT JOIN 聚合子查询（修 D-03 列表 1.4s）。

#### Scenario: 交付物搜索不扫描巨串

- **WHEN** 用户搜索交付物图片名
- **THEN** 搜索命中走元信息表，不读取/解析数 MB 的 content 字段，响应时间显著下降

### Requirement: 未关联资料的核对警示

按处置决议，**版本历史入口**（含小红书工作流缺失版本历史的问题，修 D-21）**界面隐藏、代码与接口保留**；两条工作流统一处理。

#### Scenario: 版本历史入口隐藏

- **WHEN** 用户查看交付物或任务详情
- **THEN** 界面不展示版本历史入口（后端接口与数据保留）
