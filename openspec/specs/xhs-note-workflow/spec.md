# xhs-note-workflow Specification

## Purpose
Defines the 小红书种草笔记 (XHS note) workflow: a six-stage pipeline that produces a publishable Xiaohongshu note package (选题方向 → 笔记文案 → 封面配图 → 合规审核 → 发布包装 → 交付完成), reusing the existing three agents (文案 / 设计师 / 主管) and the existing board, task-detail and content-delivery shells.

## Requirements

### Requirement: Six-stage XHS workflow definition

The system SHALL define the 小红书种草笔记 workflow as six ordered stages: 选题策划, 笔记撰写, 封面配图, 合规审核, 发布包装, 交付完成. Stage keys SHALL be prefixed with `xhs-` (`xhs-topic`, `xhs-copy`, `xhs-image`, `xhs-review`, `xhs-package`, `xhs-deliver`) so they never collide with the e-commerce workflow's stage keys.

#### Scenario: XHS stages shown in status view

- **WHEN** user opens a status view for a 小红书种草笔记 task
- **THEN** the workflow progress bar shows the six XHS stages in order with the current stage highlighted

#### Scenario: XHS stage keys are distinct from e-commerce

- **WHEN** the XHS workflow definition is loaded
- **THEN** no XHS stage key equals any e-commerce stage key, so an XHS task can never be resolved to an e-commerce stage node

### Requirement: XHS stage ownership restricted to three agents

The system SHALL route every XHS stage to one of 文案, 设计师, 主管: 选题策划 (文案), 笔记撰写 (文案), 封面配图 (设计师), 合规审核 (主管), 发布包装 (文案), 交付完成 (主管). The system SHALL NOT assign an XHS stage to an agent whose role is 助理.

#### Scenario: XHS task owners are drawn from the existing three agents

- **WHEN** an XHS task advances through its stages
- **THEN** each stage's owner is one of 美美 (文案), 平平 (设计师), 波波 (主管), and no stage is ever owned by 涵涵 (助理)

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

The system SHALL produce a note package draft at the 笔记撰写 stage consisting of a title (at most 20 characters including emoji), a note body, and topic tags.

#### Scenario: Note copy awaits confirmation

- **WHEN** the 笔记撰写 stage completes
- **THEN** the task enters 待确认 showing the title, body and tags, and waits for the user to adopt or reject it

#### Scenario: Rejected note reworks the copy stage

- **WHEN** the user rejects the note with feedback
- **THEN** the 笔记撰写 stage returns to 进行中 with the note deliverable reset, and regenerates the note

### Requirement: Cover image stage with parallel sub-tasks

The system SHALL produce one 首图 and two 内页图 at the 封面配图 stage as a parallel sub-task group, and SHALL allow retrying a single failed image without regenerating the others.

#### Scenario: Images generated as a parallel group

- **WHEN** the 封面配图 stage runs
- **THEN** 首图 and the two 内页图 are produced as sub-tasks of one image channel, and each completed image is reported individually

#### Scenario: Single image retried independently

- **WHEN** the user retries one failed image
- **THEN** only that image is regenerated and the other images keep their existing results

#### Scenario: Cover image stage awaits confirmation

- **WHEN** all cover images have been decided
- **THEN** the task enters 待确认 at 封面配图 until the user adopts or rejects the set, and rejecting returns the stage to 进行中 for rework

### Requirement: Compliance review runs automatically

The system SHALL run the 合规审核 stage automatically with no human action: when the review finds no prohibited or exaggerated wording, the task SHALL proceed to 发布包装; when it finds an issue, the task SHALL roll back to 笔记撰写 or 封面配图 according to the stage the review identifies as responsible.

#### Scenario: Compliance review passes

- **WHEN** the compliance review finds no prohibited or exaggerated wording
- **THEN** the task advances to 发布包装 without waiting for the user

#### Scenario: Compliance issue rolls back to note copy

- **WHEN** the compliance review identifies an issue attributable to the note copy
- **THEN** the task rolls back to 笔记撰写 for rework with the issue recorded, and re-enters 待确认 at that stage

#### Scenario: Compliance issue rolls back to cover image

- **WHEN** the compliance review identifies an issue attributable to the cover images
- **THEN** the task rolls back to 封面配图 for rework with the issue recorded

#### Scenario: Compliance stage never blocks on the user

- **WHEN** a task reaches 合规审核
- **THEN** the task never enters 待确认 at that stage, and no approve or reject action is offered for it

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

The system SHALL archive the publish package at the 交付完成 stage and offer next-step guidance; the download action SHALL be disabled until the task reaches 交付完成.

#### Scenario: Download disabled before delivery

- **WHEN** a 小红书种草笔记 task has not reached 交付完成
- **THEN** the download action is disabled

#### Scenario: Delivered task offers next steps

- **WHEN** a task reaches 交付完成
- **THEN** the delivery view offers viewing the publish package and creating the next task in the same workflow

### Requirement: XHS tasks scoped to the XHS workflow

The system SHALL scope an XHS task's stages, deliverables and board counts to the 小红书种草笔记 workflow, so XHS tasks never appear in the e-commerce workflow's counts and vice versa.

#### Scenario: Workflow entry counts only its own tasks

- **WHEN** the workflow list renders
- **THEN** the 小红书种草笔记 entry shows a count of XHS tasks only, excluding e-commerce tasks

#### Scenario: Board switched by workflow entry

- **WHEN** the user selects the 小红书种草笔记 workflow entry
- **THEN** the task board shows only XHS tasks
