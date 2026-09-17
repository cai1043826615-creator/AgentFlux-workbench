# xhs-note-workflow Specification

## Purpose
Defines the 小红书种草笔记 (XHS note) workflow: a six-stage pipeline that produces a publishable Xiaohongshu note package (选题方向 → 笔记文案 → 封面配图 → 合规审核 → 发布包装 → 交付完成), reusing the existing three agents (文案 / 设计师 / 主管) and the existing board, task-detail and content-delivery shells.

## Requirements

### Requirement: Six-stage XHS workflow definition

The system SHALL define the 小红书种草笔记 workflow as six ordered stages: 选题策划, 笔记撰写, 首图设计, 内页设计, 主管校对, 交付完成. Stage keys SHALL be prefixed with `xhs-` (`xhs-topic`, `xhs-copy`, `xhs-cover`, `xhs-inner`, `xhs-review`, `xhs-deliver`) so they never collide with the e-commerce workflow's stage keys. The 封面配图 stage SHALL be split into 首图设计 (exactly one cover image) and 内页设计 (inner images); the former 发布包装 stage SHALL be removed — packaging content merges into delivery and the deliverable package is exported via the 「导出交付包」 action. The human confirmation points SHALL be exactly four: 选题策划, 笔记撰写, 首图设计, 内页设计. 主管校对 and 交付完成 SHALL be automatic stages (the supervisor review passing directly archives the task).

#### Scenario: XHS stages shown in status view

- **WHEN** user opens a status view for a 小红书种草笔记 task
- **THEN** the workflow progress bar shows the six XHS stages in order (选题策划 → 笔记撰写 → 首图设计 → 内页设计 → 主管校对 → 交付完成) with the current stage highlighted

#### Scenario: XHS stage keys are distinct from e-commerce

- **WHEN** the XHS workflow definition is loaded
- **THEN** no XHS stage key equals any e-commerce stage key, so an XHS task can never be resolved to an e-commerce stage node

#### Scenario: 发布包装 no longer exists

- **WHEN** the XHS workflow definition is loaded or a task's stage bar is rendered
- **THEN** no 发布包装 stage exists; after 主管校对 passes the task goes straight to 交付完成 and archives

### Requirement: XHS stage ownership restricted to three agents

The system SHALL route every XHS stage to one of 文案, 设计师, 主管: 选题策划 (文案), 笔记撰写 (文案), 首图设计 (设计师), 内页设计 (设计师), 主管校对 (主管), 交付完成 (主管). The system SHALL NOT assign an XHS stage to an agent whose role is 助理. A task SHALL be pre-assigned the first stage's owner (文案) at creation time, before the user confirms it.

#### Scenario: XHS task owners are drawn from the existing three agents

- **WHEN** an XHS task advances through its stages
- **THEN** each stage's owner is one of 美美 (文案), 平平 (设计师), 波波 (主管), and no stage is ever owned by 依依 (助理)

#### Scenario: New task shows its first owner before starting

- **WHEN** a 小红书种草笔记 task is created and still sits in 规划中
- **THEN** its owner is already the 文案 agent (美美)

### Requirement: Topic selection output

The system SHALL produce three alternative topic directions at the 选题策划 stage, each with an angle, a description, and topic anchors, and SHALL let the user select exactly one direction before advancing.

#### Scenario: Three topic directions offered

- **WHEN** the 选题策划 stage completes
- **THEN** three topic directions are presented, each with its angle, description and topic anchors, with one preselected

#### Scenario: Selected topic drives the note

- **WHEN** the user confirms a selected topic direction
- **THEN** that direction becomes the input for the 笔记撰写 stage and the task advances to 笔记撰写

#### Scenario: Re-requesting topics reworks the stage

- **WHEN** the user requests new topics instead of confirming
- **THEN** the 选题策划 stage returns to 进行中 and regenerates three new directions

### Requirement: Note copy output

The system SHALL produce a note package draft at the 笔记撰写 stage consisting of a title (at most 20 characters including emoji), a note body of **300–500 characters** written in the 小红书 seeding style (first-person authentic experience, colloquial tone, 3–5 paragraphs, at most 1–2 emoji accents, at least one honest minor drawback for credibility), and topic tags. The task's brief fields (content type, target audience, product) SHALL be injected into the generation prompt.

#### Scenario: Note copy awaits confirmation

- **WHEN** the 笔记撰写 stage completes
- **THEN** the task enters 待确认 showing the title, body and tags, and waits for the user to adopt or reject it

#### Scenario: Rejected note reworks the copy stage

- **WHEN** the user rejects the note with feedback
- **THEN** the 笔记撰写 stage returns to 进行中 with the note deliverable reset, and regenerates the note

### Requirement: Cover image stage with parallel sub-tasks

The system SHALL split image generation into two stages: the 首图设计 stage SHALL produce **exactly one** cover image, and the system SHALL NOT generate inner images until the user confirms the cover; only after the cover is confirmed SHALL the 内页设计 stage run as a parallel sub-task group. The system SHALL allow retrying a single failed image without regenerating the others.

#### Scenario: Images generated as a parallel group

- **WHEN** the 首图设计 or 内页设计 stage runs
- **THEN** its images are produced as sub-tasks of one image channel, and each completed image is reported individually

#### Scenario: Single image retried independently

- **WHEN** the user retries one failed image
- **THEN** only that image is regenerated and the other images keep their existing results

#### Scenario: Cover image stage awaits confirmation

- **WHEN** the 首图设计 stage completes
- **THEN** exactly one cover image is presented for confirmation, and the task enters 待确认 at 首图设计

#### Scenario: Inner images start only after cover confirmation

- **WHEN** the cover image is confirmed
- **THEN** the 内页设计 stage starts and generates the inner images

### Requirement: Compliance review runs automatically

The system SHALL run the 主管校对 stage automatically with no human action, reviewing **both** text compliance (prohibited/exaggerated wording) and **visual consistency** (generated images vs the uploaded reference image when present, or vs the note's textual description when not). When no issue is found the task SHALL proceed to 交付完成 and archive; when it finds an issue, the task SHALL roll back to 笔记撰写, 首图设计 or 内页设计 according to the stage the review identifies as responsible.

#### Scenario: Compliance review passes

- **WHEN** the 主管校对 finds no prohibited wording, no medical claim, and no visual inconsistency
- **THEN** the task advances to 交付完成 and archives without waiting for the user

#### Scenario: Compliance issue rolls back to note copy

- **WHEN** the 主管校对 identifies a wording issue attributable to the note copy, citing the offending original text
- **THEN** the task rolls back to 笔记撰写 for rework with the issue recorded, and re-enters 待确认 at that stage

#### Scenario: Compliance issue rolls back to cover image

- **WHEN** the 主管校对 identifies a visual inconsistency attributable to the cover image (not matching the reference image or contradicting the note text)
- **THEN** the task rolls back to 首图设计 or 内页设计 for rework with the reason recorded

#### Scenario: Compliance stage never blocks on the user

- **WHEN** a task reaches 主管校对
- **THEN** the task never enters 待确认 at that stage, and no approve or reject action is offered for it

#### Scenario: Review report cites evidence

- **WHEN** the review marks a check as failed
- **THEN** the report cites the offending original wording with a rewrite suggestion; uncertain findings are marked 通过 with a 复核 note instead of blocking

### Requirement: Compliance stage shows no approval badge

The system SHALL render the 合规审核 stage in the stage bar without an 自动 or 确认 badge, matching how the e-commerce 主管校对 stage is rendered; that the stage is automatic SHALL be conveyed by text inside the compliance panel instead.

#### Scenario: Stage bar omits the compliance badge

- **WHEN** the stage bar renders a 小红书种草笔记 task
- **THEN** the 合规审核 node carries no badge, while the four human confirmation points carry the 确认 badge

#### Scenario: Compliance panel explains the automatic check

- **WHEN** the 合规审核 panel is rendered before the stage runs
- **THEN** it states that the 主管 agent checks automatically and no human confirmation is needed

### Requirement: Publish package output

The system SHALL produce the final publish package at the 发布包装 stage containing the title, body, tags and an ordered list of the images to publish, and SHALL let the user copy the package text.

#### Scenario: Publish package awaits final confirmation

- **WHEN** the 发布包装 stage completes
- **THEN** the task enters 待确认 showing the title, body, tags and image order, and waits for the user's final confirmation

#### Scenario: Copying the publish package

- **WHEN** the user activates copy on the publish package
- **THEN** the title, body and tags are placed on the clipboard as text

#### Scenario: Final confirmation delivers the task

- **WHEN** the user confirms the publish package
- **THEN** the task advances to 交付完成 and is marked 已完成

### Requirement: Delivery completion

The system SHALL archive the note package at the 交付完成 stage automatically once 主管校对 passes (no human confirmation at this stage), and SHALL provide a 「导出交付包」 action in the delivery view; the export SHALL be disabled until the supervisor review has passed and the task has archived.

#### Scenario: Download disabled before delivery

- **WHEN** a 小红书种草笔记 task has not passed 主管校对 and archived
- **THEN** the export action is disabled

#### Scenario: Delivered task offers next steps

- **WHEN** a task reaches 交付完成 and archives
- **THEN** the delivery view shows the archive notice and the 「导出交付包」 action

### Requirement: XHS tasks scoped to the XHS workflow

The system SHALL scope an XHS task's stages, deliverables and board counts to the 小红书种草笔记 workflow, so XHS tasks never appear in the e-commerce workflow's counts and vice versa.

#### Scenario: Workflow entry counts only its own tasks

- **WHEN** the workflow list renders
- **THEN** the 小红书种草笔记 entry shows a count of XHS tasks only, excluding e-commerce tasks

#### Scenario: Board switched by workflow entry

- **WHEN** the user selects the 小红书种草笔记 workflow entry
- **THEN** the task board shows only XHS tasks

### Requirement: Compliance review panel placement and emptiness

The 主管校对 review panel SHALL be rendered in the 内容交付 view immediately below the task info bar, and SHALL NOT render in the 任务详情 view. The panel SHALL present the automatic-check notice, the check list, and the review report; it SHALL offer no approve or reject action.

#### Scenario: Panel sits below the task info bar

- **WHEN** the 内容交付 view renders a 小红书种草笔记 task
- **THEN** the review panel appears between the task info bar and the first stage row

#### Scenario: Panel is absent from the detail tab

- **WHEN** the user switches to the 任务详情 tab
- **THEN** no review panel is rendered there

### Requirement: Deliverable package export replaces the package stage

The system SHALL let the user export the deliverable package (note text and all adopted images) via a 「导出交付包」 action shown when the task is archiving or already archived; the exported ZIP SHALL contain the note text as files and every adopted image. The download action SHALL be disabled until the task has completed its review and archived.

#### Scenario: Export available after archiving

- **WHEN** a task has archived
- **THEN** the delivery view shows 「导出交付包」 and the exported ZIP contains the note text and all adopted images

#### Scenario: Export disabled before review completes

- **WHEN** a task has not passed 主管校对 and archived
- **THEN** the export action is disabled

### Requirement: Image placeholders carry no mock labeling

Image placeholder tiles (for a generated-but-unavailable image or a failed generation) SHALL show only the image name; they SHALL NOT display 「模拟占位」 or similar mock wording — the state is expressed by the status badge and failure note below the tile.

#### Scenario: Placeholder tile shows only the name

- **WHEN** a cover or inner image tile renders without a real image
- **THEN** the tile shows the image name only, with no mock wording

### Requirement: Legacy tasks degrade gracefully

A task whose current stage key no longer exists in its workflow definition (created before a structure change) SHALL render a legacy notice in the 内容交付 view instead of the stage panels — the notice SHALL state that the task predates the structure change and its deliverables/events remain viewable in 任务详情; no confirmation actions or stage panels SHALL be rendered for it.

#### Scenario: Legacy task shows a notice instead of panels

- **WHEN** the 内容交付 view renders a task stopped at a removed stage (e.g. xhs-image)
- **THEN** a legacy notice is shown and no stage panels, placeholders or one-click actions are rendered

### Requirement: Inner image stage honors the requested image count

The system SHALL generate inner images at the 内页设计 stage, where the total image count (cover + inner) comes from the task's brief (`imageCount`), clamped to 2–7 with a default of 3 — i.e. inner images = imageCount − 1 (the cover is fixed at one and not counted in the inner total). Each inner image SHALL be individually decidable (采纳/打回/重试).

#### Scenario: Inner image count follows the brief

- **WHEN** a task was created with 配图数量 = 3
- **THEN** the 内页设计 stage produces exactly 2 inner images (3 total including the cover)

#### Scenario: Out-of-range or missing count falls back to default

- **WHEN** a task's brief has no imageCount or an out-of-range value
- **THEN** the inner image count falls back to the default (2 inner images, 3 total)
