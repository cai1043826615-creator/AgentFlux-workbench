## MODIFIED Requirements

### Requirement: Pending approve/reject actions only

审批动作相关的**全局提示（Toast）SHALL 按 key 清理**：同一条目的新提示出现时替换旧提示，不得无限堆积（修 D-07「审批提示永不消失」）。

#### Scenario: 连续审批不堆积提示

- **WHEN** 用户对同一任务的多个交付物连续执行采纳/驳回
- **THEN** 界面只保留最新一条审批结果提示，旧提示被替换而非堆积

### Requirement: Per-image approve/reject wired to approval points

系统 SHALL 保证图片交付物展示顺序与工作流声明顺序一致（按 `groups` 中声明的分组与条目顺序重排，修 D-22「图片顺序不确定」——不再依赖并行完成的先后顺序）。

#### Scenario: 图片顺序稳定

- **WHEN** 用户打开含多张图片的内容交付面板
- **THEN** 图片按工作流声明顺序展示，多次刷新顺序不变

### Requirement: Copy package preview

文案摘要/预览 SHALL 按阶段正确取数：优先取当前阶段对应的交付物，不因 `find` 取到第一个 copy 型交付物而摘要错阶段（修 D-23「文案摘要取错阶段」）。

#### Scenario: 摘要取对阶段

- **WHEN** 用户查看某阶段的文案摘要
- **THEN** 摘要来自该阶段产出的交付物，而非其他阶段的 copy

### Requirement: Stage-sequence layout for workflows without paired copy/image deliverables

阶段显示名 SHALL 走**别名表**：内部阶段 id（如 `xhs-image`）SHALL NOT 直接暴露在界面，统一显示为用户可见的阶段名（修 D-12「界面暴露内部阶段 id」、D-13「同一阶段两个名字」）。改后 SHALL 全局 grep 复查无内部 id 残留（U7）。

#### Scenario: 界面不暴露内部阶段 id

- **WHEN** 用户查看任务阶段条或交付面板
- **THEN** 界面展示用户可见阶段名，不出现 `xhs-image` 等内部 id
