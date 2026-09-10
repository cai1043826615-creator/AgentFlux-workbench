# Workflow Engine

## Purpose

Defines the workflow engine for e-commerce new-product listing: a six-stage pipeline (需求对齐 → 卖点文案 → 主图设计 → 详情图设计 → 主管校对 → 交付完成) with two human approval points, automatic progression, supervisor review, and stage rollback. The workflow is defined as a graph of nodes, edges, and conditional branches; a stage may schedule parallel sub-tasks (e.g. generating multiple images concurrently).

## Requirements

### Requirement: Six-stage workflow definition

The system SHALL define the e-commerce listing workflow as six ordered stages: 需求对齐, 卖点文案, 主图设计, 详情图设计, 主管校对, 交付完成.

#### Scenario: Workflow stages shown in status view

- **WHEN** user opens a task status view
- **THEN** the workflow progress bar shows the six stages in order with the current stage highlighted

### Requirement: Stage assignment and inputs

The system SHALL route each stage to the responsible agents: 需求对齐 (人工+文案), 卖点文案 (文案+主管), 主图设计 (设计师+主管), 详情图设计 (设计师+主管), 主管校对 (主管), 交付完成 (主管+人工).

#### Scenario: Stage routed to responsible agent

- **WHEN** a task reaches the 卖点文案 stage
- **THEN** the 文案 agent picks it up and starts producing the copy package from the listing requirement document

### Requirement: Human approval points

The system SHALL place two human approval points in the workflow: after 卖点文案 output and after 主图设计 output; at these points the task enters the 待确认 column and waits for the user's decision.

#### Scenario: Approval point after copy output

- **WHEN** the 文案 agent finishes the copy package
- **THEN** the task moves to 待确认 with a "needs your decision" prompt, and blocks until the user approves or rejects

#### Scenario: Approval point after main image output

- **WHEN** the 设计师 agent finishes the main image set
- **THEN** the task moves to 待确认 with an approval prompt for the main images

#### Scenario: Approve advances the workflow

- **WHEN** the user approves an approval point
- **THEN** the current stage completes and the next stage task moves from 规划中 to 进行中

#### Scenario: Reject returns for rework

- **WHEN** the user rejects an approval point with feedback
- **THEN** the task returns to 进行中 for rework, then re-enters 待确认 after the rework is redone

#### Scenario: Rework re-enters approval with reset deliverables

- **WHEN** a reworked task re-enters 待确认 at an approval point
- **THEN** its pending deliverable states are reset to pending so the user can decide again

### Requirement: Approval actions driven from content delivery

The system SHALL drive approval-point transitions from the per-item actions in the 内容交付 page: copy approve/reject at approval point 1 (卖点文案), and per-image approve/reject at approval point 2 (主图设计); the stage advances only after all pending images are decided.

#### Scenario: Copy approval advances at point 1

- **WHEN** the user approves the pending copy package while the task is at approval point 1
- **THEN** the task advances to 主图设计

#### Scenario: Image approval completes point 2

- **WHEN** the user approves all pending images while the task is at approval point 2
- **THEN** the task advances to 详情图设计

### Requirement: Automatic progression without approval points

The system SHALL automatically advance stages that have no human approval point, with zero manual intervention.

#### Scenario: Auto-progress detail image stage

- **WHEN** the 详情图设计 stage completes
- **THEN** the system automatically continues to the next stage without waiting for the user

### Requirement: Supervisor review with rollback

The system SHALL run a full supervisor review at the 主管校对 stage; if issues are found, the affected earlier stage task rolls back from 已完成 to 进行中 for rework.

#### Scenario: Supervisor finds issue and rolls back

- **WHEN** the supervisor review finds a main-image/copy inconsistency
- **THEN** the corresponding stage task rolls back to 进行中 with modification notes, and re-runs the pipeline

#### Scenario: Supervisor review passes

- **WHEN** all outputs pass the supervisor review
- **THEN** the task proceeds to 交付完成

### Requirement: Task status view

The system SHALL provide a task status view replacing the board view, showing task summary, workflow stage progress, pending confirmation items, and a task workflow preview.

#### Scenario: Status view content

- **WHEN** user opens the task status view
- **THEN** it shows the task summary, the six-stage progress, any pending confirmation items, and a workflow preview

### Requirement: Graph-based workflow definition

The system SHALL define the workflow as a graph: each stage is a node, ordered edges connect nodes, approval points and the supervisor review are conditional branch edges, and a node may declare parallel sub-task groups.

#### Scenario: Approval point as conditional branch

- **WHEN** the user approves or rejects an approval point
- **THEN** the engine follows the approved edge to advance to the next stage, or the rejected edge to return the current stage node for rework

#### Scenario: Supervisor review branch

- **WHEN** the supervisor review passes
- **THEN** the engine follows the pass edge to 交付完成; when issues are found, it follows the rollback edge to the affected stage node

#### Scenario: Workflow graph persisted as definition

- **WHEN** a workflow is configured
- **THEN** its nodes, edges, branch rules, and parallel group declarations are persisted as workflow definition data and executed by the engine

### Requirement: Parallel execution within a stage

The system SHALL execute declared parallel sub-task groups within a stage concurrently — groups of different channels in parallel, tasks within the same channel sequentially — to avoid API rate limiting, and report each completed sub-task promptly.

#### Scenario: Main image stage runs in parallel

- **WHEN** the 主图设计 stage produces multiple main images
- **THEN** image sub-tasks grouped by image channel run in parallel, while sub-tasks of the same channel run sequentially, and each completed image is reported via progress events

#### Scenario: Detail image stage runs in parallel

- **WHEN** the 详情图设计 stage produces multiple detail images
- **THEN** the same channel-grouped parallel execution applies, with per-image progress reporting
