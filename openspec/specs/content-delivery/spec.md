# Content Delivery

## Purpose

Defines the content delivery capability: previewing workflow deliverables inside the workbench via a "内容交付" tab in the task status view. The page is a **two equal-width side-by-side panes layout** (left 文案成品 / right 图片成品); each pane is rendered **only when its content is delivered** and shows a placeholder otherwise. Per-item approve/reject actions appear only while an item is pending, disappear once decided, and drive the workflow approval state machine.

## Requirements

### Requirement: Content delivery tab in task status view

The system SHALL provide a "内容交付" (content delivery) tab inside the task status view alongside the task details tab.

#### Scenario: Switch to content delivery tab

- **WHEN** user opens a task status view and clicks the 内容交付 tab
- **THEN** the delivered content for the task is shown instead of the task details

### Requirement: Two equal-width side-by-side panes

The system SHALL lay out the content delivery page of an e-commerce listing task as two side-by-side panes of equal width: left 文案成品, right 图片成品. Both panes share the same height (taller content stretches both). For a task whose workflow does not produce exactly one copy deliverable and one image deliverable, the system SHALL use that workflow's own layout instead.

#### Scenario: Equal panes layout

- **WHEN** the content delivery page is rendered
- **THEN** 文案成品 and 图片成品 are placed side by side with equal width and matching pane height

#### Scenario: Non-paired workflow uses its own layout

- **WHEN** the content delivery page renders a task whose workflow does not have exactly one copy pane and one image pane
- **THEN** the two-pane layout is not applied and the workflow's own layout is used

### Requirement: Pane visibility driven by delivery state

The system SHALL render each pane according to its delivery state: a placeholder (尚未产出 / 生成中…) when the content is not yet produced, or the produced content when delivered. A pane for not-yet-produced content MUST NOT show empty content; a not-yet-generated image area MUST be replaced by a placeholder instead of showing an empty gallery.

#### Scenario: Copy pane before production

- **WHEN** the task is still in 需求对齐 or 卖点文案 in progress
- **THEN** the 文案成品 pane shows a "尚未产出 / 文案生成中…" placeholder instead of copy content

#### Scenario: Image pane before generation

- **WHEN** the 主图设计 stage has not yet produced images
- **THEN** the 图片成品 pane shows a "尚未产出 / 主图生成中…" placeholder instead of an image gallery

### Requirement: Copy package preview

The system SHALL render the copy deliverable (标题, 5 核心卖点, 详情文案大纲, 关键词清单) as a formatted card when the 卖点文案 stage has output. The card SHALL present the **current version's** content first and without competing visual weight. Version history SHALL NOT appear above the current content: it SHALL be reachable from a control placed on the current content's header, SHALL be collapsed by default, and SHALL expand in place below the current content when activated. When the deliverable has no reference image, the delivery view SHALL display copy that states the output is AI-generated without a reference image, and MUST NOT claim the output is based on a reference image.

#### Scenario: View copy package card

- **WHEN** the 卖点文案 stage has output and is awaiting or approved
- **THEN** the copy package is displayed as a card with title, five core selling points, detail outline, and keywords

#### Scenario: Current version reads first

- **WHEN** user opens the content delivery view for a task whose deliverable has more than one version
- **THEN** the current version's content appears above any version history, and no historical version preview is expanded by default

#### Scenario: Version history is collapsed by default

- **WHEN** the content delivery view renders a deliverable that has version history
- **THEN** only a collapsed history control is visible on the current content's header, and the historical content is not rendered expanded

#### Scenario: Version history expands in place

- **WHEN** user activates the collapsed history control
- **THEN** the history panel expands below the current content, and the current content remains above it

#### Scenario: Copy reflects absence of reference image

- **WHEN** a task has no user-uploaded reference image
- **THEN** the delivery view states that images are AI-generated without a reference image, and does not display copy claiming generation is based on a reference image

#### Scenario: Copy reflects presence of reference image

- **WHEN** a task has a user-uploaded reference image
- **THEN** the delivery view states that AI output is generated based on the reference image

### Requirement: Image gallery preview

The system SHALL render image deliverables (main images, detail images) as a gallery with per-image status once the 主图设计 stage has output.

#### Scenario: Image gallery shown when generated

- **WHEN** the 主图设计 stage has output and is awaiting or approved
- **THEN** the images are displayed in a gallery, each showing its individual approve/reject status badge

### Requirement: Pending approve/reject actions only

The system SHALL provide approve (采纳) and reject (打回) actions on a delivered item **only while it is pending**; once an item is decided (approved or rejected), its action buttons MUST disappear and only a status badge (✓ 已采纳 / ✗ 已打回) remains. For a task awaiting confirmation, the approval bar SHALL **host the approve/reject actions** for the pending item rather than only explaining where those actions live, and its explanatory text SHALL be a **single short line** stating the state and the consequence of approving. The approval bar SHALL NOT render a long sentence describing where the buttons are located.

#### Scenario: Approve hides buttons

- **WHEN** user clicks 采纳 on a pending copy package or image
- **THEN** the item is marked approved, its 采纳/打回 buttons disappear, and a "已采纳 ✓" status is shown instead

#### Scenario: Decided item shows status only

- **WHEN** a delivered item is already approved or rejected
- **THEN** the item shows only its status badge and no approve/reject buttons

#### Scenario: Approval bar hosts the decision actions

- **WHEN** a task is awaiting the user's confirmation
- **THEN** the approval bar presents the 采纳 / 打回 actions for the pending item, so the user does not have to hunt for them inside the content card

#### Scenario: Approval bar text is a single short line

- **WHEN** the approval bar renders
- **THEN** its explanatory text is one short line (e.g. 「待你确认 · 采纳后自动进入主图设计」) and does not span a long explanatory sentence across the full bar width

#### Scenario: Approval still advances the workflow

- **WHEN** the user approves from the approval bar
- **THEN** the workflow advances exactly as before, and rejecting still routes the item back for rework

### Requirement: Per-image approve/reject wired to approval points

The system SHALL provide approve/reject on **each image individually**, and SHALL advance the workflow approval point once **all images in the current set are decided**: if any was rejected the stage returns for rework; if all were approved the task advances to the next stage.

#### Scenario: All images approved advances the stage

- **WHEN** the user approves every pending image of the 主图设计 set
- **THEN** the task advances to the next stage

#### Scenario: Any image rejected returns for rework

- **WHEN** the user rejects one or more images of the set
- **THEN** the stage returns to 进行中 for rework and the images reset to pending when re-entering 待确认

### Requirement: Deliverables scoped per task

The system SHALL scope delivered content to its task (per task_id), not as a global singleton, so different tasks carry independent copy/image deliverable states.

#### Scenario: Deliverables differ per task

- **WHEN** two tasks are at different workflow stages
- **THEN** each task's 内容交付 page reflects its own deliverables and states independently

### Requirement: Stage-sequence layout for workflows without paired copy/image deliverables

The system SHALL render the content delivery page for a 小红书种草笔记 task as a vertical sequence of one panel per stage, ordered as the workflow defines them, instead of the two side-by-side panes. Each stage panel SHALL render its own state: a muted placeholder while the stage has not started, its produced content once the stage has output, and its decision actions only while the stage is pending.

#### Scenario: XHS delivery view renders stage panels in order

- **WHEN** the content delivery view renders a 小红书种草笔记 task
- **THEN** one panel per stage is rendered top to bottom in workflow order: 选题策划, 笔记撰写, 封面配图, 合规审核, 发布包装, 交付完成

#### Scenario: Not-yet-started stage shows a muted placeholder

- **WHEN** a 小红书种草笔记 stage has not started
- **THEN** its panel shows a muted placeholder stating it starts after the previous stage is confirmed, and MUST NOT show a generating or in-progress state

#### Scenario: Automatic stage renders no decision actions

- **WHEN** the 合规审核 panel is rendered
- **THEN** it shows the compliance check results and no approve or reject action

#### Scenario: Pending stage hosts its decision actions

- **WHEN** a 小红书种草笔记 stage is awaiting the user's confirmation
- **THEN** that stage's panel presents the actions for adopting or rejecting its output
