## MODIFIED Requirements

### Requirement: Markdown 原文阅读
系统 SHALL 在工作台内渲染已索引文档的 Markdown 原文（标题、段落、列表、链接、代码块等），供阅读与引用。文档正文内的链接（含 wiki 链接与内部文档链接）SHALL 使用 Quiet Signal 设计令牌作为唯一颜色来源，MUST NOT 被框架内建的默认调色板工具类覆盖；当令牌值变更时，链接颜色 SHALL 随之变更而不需要逐处修改。

#### Scenario: 打开文档阅读
- **WHEN** 用户从浏览/搜索结果打开一篇文档
- **THEN** 工作台渲染该文档正文，并提供该文档的相对路径与目录位置信息

#### Scenario: 链接颜色取自设计令牌
- **WHEN** 用户在阅读视图查看文章内的 wiki 链接或内部文档链接
- **THEN** 链接的计算颜色等于当前 Quiet Signal signal 令牌的值，不由框架默认调色板工具类决定

#### Scenario: 链接色随令牌统一变更
- **WHEN** Quiet Signal 的 signal 令牌值被调整
- **THEN** 文档正文内的链接颜色随之变化，无需单独修改链接相关代码

#### Scenario: 链接仍可跳转
- **WHEN** 用户点击正文内的 wiki 链接或内部文档链接
- **THEN** 系统按既有跳转能力打开对应文档，链接的可点击性不因颜色约束而改变
