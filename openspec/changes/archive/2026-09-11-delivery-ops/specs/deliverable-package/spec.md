## Purpose

交付物的「版本可追溯」与「物料可带走」：文案/图片被反复打回重做时，保留每一版产出快照，并给出与上一版的差异（至少列出新增/删除的卖点行）；任务交付归档后，提供可下载的 ZIP 交付包（最终文案 + 全部已采纳图片原图），让渠道运营真正拿得到物料，而不是只拿到一句「资料包已完成」的描述。

## ADDED Requirements

### Requirement: 交付物版本历史留档
系统 SHALL 在交付物每次重新产出（同任务、同阶段、同种类）时，于覆盖当前内容**之前**把上一版快照写入 `deliverable_versions` 表留档；留档版本号 SHALL 与 `deliverables.version` 的递增保持一致，且 `(deliverable_id, version)` 唯一。留档 SHALL 覆盖 `copy` 与 `image` 两种交付物种类。既有 `deliverables` 表的字段与状态机行为 SHALL 不变。

#### Scenario: 文案打回重做后两个版本都在库里
- **WHEN** 文案交付物首次产出为 v1，用户打回后文案 Agent 重新产出为 v2
- **THEN** `GET /api/tasks/:id/deliverables/:kind/versions`（`kind=copy`）返回至少 v1 与 v2 两条记录，且 v1 的 `content` 是首次产出时的完整文案包内容（不是 v2 的内容）

#### Scenario: 版本号与当前交付物一致
- **WHEN** 某交付物当前 `version` 为 N
- **THEN** 其版本历史中的最大版本号等于 N，且历史记录条数不多于 N

#### Scenario: 图片重产出同样留档
- **WHEN** 图片交付物在 `main-image` 阶段被重产出一次
- **THEN** 该交付物的版本历史包含重产出前的图片条目快照（含每张图的 `id` 与 `status`）

#### Scenario: 首次产出不留多余历史
- **WHEN** 某交付物从未被重产出（`version = 1`）
- **THEN** 其版本历史最多只有 1 条记录（v1），不产生空记录或重复记录

#### Scenario: 历史表幂等建表与既有数据回填
- **WHEN** 服务启动执行 `ensureSchema()`，且库中已存在旧交付物行
- **THEN** `deliverable_versions` 表被创建（已存在则无副作用），且每个缺少历史记录的既有交付物以其当前 `content` 与当前 `version` 回填一条基线记录；重复启动不产生重复记录

### Requirement: 相邻版本差异提示
系统 SHALL 提供交付物相邻版本的差异计算：对 `copy` 交付物 SHALL 至少列出**新增的卖点行**与**删除的卖点行**（以归一化后的卖点文本比对），并 SHALL 标注标题、详情大纲、关键词是否发生变化；对 `image` 交付物 SHALL 列出新增与删除的图片条目（按图片 `id` 比对）。差异结果 SHALL 通过接口可获取，并在内容交付页可查看。

#### Scenario: 卖点行新增与删除被列出
- **WHEN** v1 的卖点行为 `["30W 快充", "磁吸吸附"]`，v2 的卖点行为 `["30W 快充", "航空铝外壳"]`
- **THEN** 差异结果中「新增卖点行」含 `航空铝外壳`，「删除卖点行」含 `磁吸吸附`，「保留卖点行」含 `30W 快充`

#### Scenario: 卖点顺序变化不算增删
- **WHEN** v2 仅调换了 v1 中已有卖点行的顺序
- **THEN** 差异结果的「新增卖点行」与「删除卖点行」均为空，「保留卖点行」包含全部卖点行

#### Scenario: 标题与关键词变化被标注
- **WHEN** v2 相对 v1 修改了 `title` 并新增了一个 `keyword`
- **THEN** 差异结果标记标题已变化，并在关键词变化中列出新增的关键词

#### Scenario: 两个版本完全一致
- **WHEN** v2 与 v1 的文案包内容完全相同
- **THEN** 差异结果返回「与上一版一致」的明确标识（各差异数组为空），不报错

#### Scenario: 只有一个版本时无可对比对象
- **WHEN** 请求某个仅有 v1 的交付物的差异
- **THEN** 接口返回「无上一版可对比」的明确状态，不报错、不返回空对象

#### Scenario: 图片交付物版本差异
- **WHEN** `main-image` 的 v2 相比 v1 少了 1 张图并多了 1 张图
- **THEN** 差异结果列出被删除图片的 `id` 与新增图片的 `id`

### Requirement: 交付包 ZIP 打包下载
系统 SHALL 为任务提供交付包 ZIP 下载端点 `GET /api/tasks/:id/deliverable-package`，返回 `application/zip` 附件。ZIP 内容 SHALL 包含：最终文案（来自 `deliver` 阶段采用的上架资料包交付物，Markdown 或纯文本形式）与**全部已采纳（`status = approved`）的图片原图**。ZIP 内文件命名 SHALL 体现阶段与图片名称，便于直接分发。已打回（`rejected`）与生成失败（`failed`）的图片 SHALL 不入包。下载 SHALL 零新增运行时依赖实现。

#### Scenario: 下载归档任务的交付包
- **WHEN** 用户对一个已归档任务点击「下载交付包」
- **THEN** 浏览器下载到 `交付包-任务<id>-<标题>.zip`，解压后含文案文件与全部已采纳图片文件，且图片字节与原图一致（可正常打开）

#### Scenario: 只含已采纳图片
- **WHEN** 任务的图片交付物中混有 `approved` / `rejected` / `failed` 三种状态
- **THEN** ZIP 中只出现 `approved` 的图片，`rejected` 与 `failed` 的图片不出现

#### Scenario: dataURL 与 http URL 两种图片来源都能入包
- **WHEN** 某已采纳图片 `url` 为 `data:image/png;base64,...`，另一张为 `http(s)://...` 或 `/uploads/xxx.png`
- **THEN** 两类图片都能被正确解码/取回并写入 ZIP，且扩展名与图片实际类型一致

#### Scenario: 任务无任何已定案交付物
- **WHEN** 请求一个尚未产出任何交付物的任务的交付包
- **THEN** 接口返回 `409` 与明确的中文错误说明（不返回空 ZIP、不返回 500）

#### Scenario: 单张图片无法获取时不整体失败
- **WHEN** 某已采纳图片的 http URL 取回失败（超时或 404）
- **THEN** ZIP 仍可下载，缺失图片以同名 `.txt` 说明文件替代（写明失败原因），并在响应头或清单文件中标注缺失数量

### Requirement: 交付包内容清单
系统 SHALL 在 ZIP 内附一份机器可读的清单文件（如 `manifest.json`），列出任务 id、标题、目标平台、生成时间、文案文件路径、每张入包图片的名称/来源阶段/状态，以及被排除图片的数量与原因分类，便于渠道运营核对物料完整性。

#### Scenario: 清单可核对
- **WHEN** 解压交付包
- **THEN** `manifest.json` 存在，包含任务 id、标题、目标平台、生成时间、入包图片数量与排除图片数量，且入包图片条目数与 ZIP 内实际图片文件数一致

#### Scenario: 未产出文案时的清单
- **WHEN** 任务只有图片交付物、没有文案交付物
- **THEN** `manifest.json` 中文案字段为 `null` 或空，ZIP 仍正常生成且包含图片
