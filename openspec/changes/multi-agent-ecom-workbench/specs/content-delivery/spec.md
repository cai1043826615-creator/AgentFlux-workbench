## Purpose

Defines the content delivery capability: previewing workflow deliverables inside the workbench via a "内容交付" tab in the task status view. The page is a **two equal-width side-by-side panes layout** (left 文案成品 / right 图片成品); each pane is rendered **only when its content is delivered** and shows a placeholder otherwise. Per-item approve/reject actions appear only while an item is pending, disappear once decided, and drive the workflow approval state machine.

## ADDED Requirements

### Requirement: Content delivery tab in task status view

The system SHALL provide a "内容交付" (content delivery) tab inside the task status view alongside the task details tab.

#### Scenario: Switch to content delivery tab

- **WHEN** user opens a task status view and clicks the 内容交付 tab
- **THEN** the delivered content for the task is shown instead of the task details

### Requirement: Two equal-width side-by-side panes

The system SHALL lay out the content delivery page as two side-by-side panes of equal width: left 文案成品, right 图片成品. Both panes share the same height (taller content stretches both).

#### Scenario: Equal panes layout

- **WHEN** the content delivery page is rendered
- **THEN** 文案成品 and 图片成品 are placed side by side with equal width and matching pane height

### Requirement: Pane visibility driven by delivery state

The system SHALL render each pane according to its delivery state: a placeholder (尚未产出 / 生成中…) when the content is not yet produced, or the produced content when delivered. A pane for not-yet-produced content MUST NOT show empty content; a not-yet-generated image area MUST be replaced by a placeholder instead of showing an empty gallery.

#### Scenario: Copy pane before production

- **WHEN** the task is still in 需求对齐 or 卖点文案 in progress
- **THEN** the 文案成品 pane shows a "尚未产出 / 文案生成中…" placeholder instead of copy content

#### Scenario: Image pane before generation

- **WHEN** the 主图设计 stage has not yet produced images
- **THEN** the 图片成品 pane shows a "尚未产出 / 主图生成中…" placeholder instead of an image gallery

### Requirement: Copy package preview

The system SHALL render the copy deliverable (标题, 5 核心卖点, 详情文案大纲, 关键词清单) as a formatted card when the 卖点文案 stage has output.

#### Scenario: View copy package card

- **WHEN** the 卖点文案 stage has output and is awaiting or approved
- **THEN** the copy package is displayed as a card with title, five core selling points, detail outline, and keywords

### Requirement: Image gallery preview

The system SHALL render image deliverables (main images, detail images) as a gallery with per-image status once the 主图设计 stage has output.

#### Scenario: Image gallery shown when generated

- **WHEN** the 主图设计 stage has output and is awaiting or approved
- **THEN** the images are displayed in a gallery, each showing its individual approve/reject status badge

### Requirement: Pending approve/reject actions only

The system SHALL provide approve (采纳) and reject (打回) actions on a delivered item **only while it is pending**; once an item is decided (approved or rejected), its action buttons MUST disappear and only a status badge (✓ 已采纳 / ✗ 已打回) remains.

#### Scenario: Approve hides buttons

- **WHEN** user clicks 采纳 on a pending copy package or image
- **THEN** the item is marked approved, its 采纳/打回 buttons disappear, and a "已采纳 ✓" status is shown instead

#### Scenario: Decided item shows status only

- **WHEN** a delivered item is already approved or rejected
- **THEN** the item shows only its status badge and no approve/reject buttons

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
