## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Two equal-width side-by-side panes

The system SHALL lay out the content delivery page of an e-commerce listing task as two side-by-side panes of equal width: left 文案成品, right 图片成品. Both panes share the same height (taller content stretches both). For a task whose workflow does not produce exactly one copy deliverable and one image deliverable, the system SHALL use that workflow's own layout instead.

#### Scenario: Equal panes layout

- **WHEN** the content delivery page is rendered
- **THEN** 文案成品 and 图片成品 are placed side by side with equal width and matching pane height

#### Scenario: Non-paired workflow uses its own layout

- **WHEN** the content delivery page renders a task whose workflow does not have exactly one copy pane and one image pane
- **THEN** the two-pane layout is not applied and the workflow's own layout is used
