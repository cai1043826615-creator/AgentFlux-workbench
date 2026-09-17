# Workflow Engine

## Purpose

Defines the workflow engine for e-commerce new-product listing: a six-stage pipeline (需求对齐 → 卖点文案 → 主图设计 → 详情图设计 → 主管校对 → 交付完成) with three human approval points, automatic progression, supervisor review, and stage rollback. The workflow is defined as a graph of nodes, edges, and conditional branches; a stage may schedule parallel sub-tasks (e.g. generating multiple images concurrently).

## Requirements

### Requirement: Six-stage workflow definition

The system SHALL define the e-commerce listing workflow as six ordered stages: 需求对齐, 卖点文案, 主图设计, 详情图设计, 主管校对, 交付完成, with 主管校对 followed by an automatic 交付完成 stage (no human confirmation at the end — the supervisor review passing directly archives the task). This workflow SHALL be one of the registered workflows, identified by its own workflow id, and SHALL remain the default workflow for tasks that do not specify one.

#### Scenario: Workflow stages shown in status view

- **WHEN** user opens a task status view
- **THEN** the workflow progress bar shows the six stages in order with the current stage highlighted

#### Scenario: Existing e-commerce tasks keep the e-commerce workflow

- **WHEN** a task created before another workflow existed is opened
- **THEN** it is resolved against the e-commerce workflow and its six stages render unchanged

### Requirement: Stage assignment and inputs

The system SHALL route each stage to the responsible agents: 需求对齐 (人工+文案), 卖点文案 (文案+主管), 主图设计 (设计师+主管), 详情图设计 (设计师+主管), 主管校对 (主管), 交付完成 (主管+人工).

#### Scenario: Stage routed to responsible agent

- **WHEN** a task reaches the 卖点文案 stage
- **THEN** the 文案 agent picks it up and starts producing the copy package from the listing requirement document

### Requirement: Human approval points

The system SHALL place three human approval points in the workflow: after 卖点文案 output, after 主图设计 output, and after 详情图设计 output; at these points the task enters the 待确认 column and waits for the user's decision.

#### Scenario: Approval point after copy output

- **WHEN** the 文案 agent finishes the copy package
- **THEN** the task moves to 待确认 with a "needs your decision" prompt, and blocks until the user approves or rejects

#### Scenario: Approval point after main image output

- **WHEN** the 设计师 agent finishes the main image set
- **THEN** the task moves to 待确认 with an approval prompt for the main images

#### Scenario: Approval point after detail image output

- **WHEN** the 设计师 agent finishes the detail image set
- **THEN** the task moves to 待确认 with an approval prompt for the detail images

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

The system SHALL drive approval-point transitions from the per-item actions in the 内容交付 page: copy approve/reject at approval point 1 (卖点文案), per-image approve/reject at approval point 2 (主图设计), and per-image approve/reject at approval point 3 (详情图设计); the stage advances only after all pending images are decided.

#### Scenario: Copy approval advances at point 1

- **WHEN** the user approves the pending copy package while the task is at approval point 1
- **THEN** the task advances to 主图设计

#### Scenario: Image approval completes point 2

- **WHEN** the user approves all pending images while the task is at approval point 2
- **THEN** the task advances to 详情图设计

#### Scenario: Image approval completes point 3

- **WHEN** the user approves all pending images while the task is at approval point 3
- **THEN** the task advances to 主管校对

### Requirement: Automatic progression without approval points

The system SHALL automatically advance stages that have no human approval point, with zero manual intervention.

#### Scenario: Auto-progress requirement stage

- **WHEN** the 需求对齐 stage completes
- **THEN** the system automatically continues to the 卖点文案 stage without waiting for the user

#### Scenario: Auto-progress after detail approval

- **WHEN** the user approves all pending detail images at approval point 3
- **THEN** the system automatically runs the 主管校对 stage without waiting for the user

### Requirement: Supervisor review with rollback

The system SHALL run a full supervisor review at the 主管校对 stage; if issues are found, the affected earlier stage task rolls back from 已完成 to 进行中 for rework.

#### Scenario: Supervisor finds issue and rolls back

- **WHEN** the supervisor review finds a main-image/copy inconsistency
- **THEN** the corresponding stage task rolls back to 进行中 with modification notes, and re-runs the pipeline

#### Scenario: Supervisor review passes

- **WHEN** all outputs pass the supervisor review
- **THEN** the task proceeds to 交付完成

### Requirement: Task status view

The system SHALL provide a task status view replacing the board view, showing task summary, the workflow stage progress of that task's own workflow, pending confirmation items, and a task workflow preview.

#### Scenario: Status view content

- **WHEN** user opens the task status view
- **THEN** it shows the task summary, the stage progress of that task's own workflow, any pending confirmation items, and a workflow preview

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

### Requirement: Multiple registered workflows

The system SHALL support more than one registered workflow: each workflow SHALL be persisted with its own id and graph definition, SHALL be listable, and a task SHALL carry the id of the workflow it belongs to. The system SHALL resolve a task's stages, approval points, owners and progression using the graph of that task's own workflow.

#### Scenario: Workflow list returns every registered workflow

- **WHEN** the workflow list is requested
- **THEN** every workflow persisted in the system is returned, not only the e-commerce one

#### Scenario: Task is created into a chosen workflow

- **WHEN** the user creates a task and selects a workflow
- **THEN** the created task records that workflow's id and starts at that workflow's first stage

#### Scenario: Task progresses along its own workflow's graph

- **WHEN** a task belonging to a non-e-commerce workflow advances
- **THEN** stage order, approval points and owner roles come from that task's own workflow graph, never from the e-commerce graph

#### Scenario: Workflow entry counts only its own tasks

- **WHEN** the workflow list is displayed
- **THEN** each workflow entry counts only the tasks belonging to that workflow

### Requirement: Missing workflow definition fails loudly

The system SHALL NOT silently fall back to another workflow's graph when a requested workflow definition cannot be loaded. The system SHALL fall back only for the default workflow, and SHALL surface an error for any other workflow whose definition is missing or unreadable.

#### Scenario: Non-default workflow missing

- **WHEN** a non-default workflow's definition cannot be loaded
- **THEN** the system raises an error naming the workflow id instead of executing the task against a different workflow's graph

#### Scenario: Corrupt workflow definition

- **WHEN** a persisted workflow definition cannot be parsed
- **THEN** the system raises an error rather than substituting another workflow's stages

### Requirement: Stage scheduling derived from the task's workflow graph

The system SHALL derive stage scheduling inputs — the ordered stage keys, the set of approval points, and the agent that owns a stage — from the task's own workflow graph, and SHALL NOT rely on a fixed stage-key-to-agent or stage-key-to-approval mapping.

#### Scenario: Approval points come from the task's graph

- **WHEN** the system decides whether a stage blocks for human confirmation
- **THEN** it consults that task's workflow graph rather than a fixed list of stage keys

#### Scenario: Stage owner comes from the task's graph

- **WHEN** a stage is dispatched to an agent
- **THEN** the owning agent is resolved from that stage's declared owner role in the task's workflow graph

#### Scenario: Unknown stage key does not silently no-op

- **WHEN** a task's current stage is not a node of its own workflow graph
- **THEN** the system raises an error instead of leaving the task idle without progress

### Requirement: Approval decisions routed by workflow

The system SHALL route approval and rejection decisions for a task through that task's own workflow, so that adopting or rejecting a deliverable in a non-e-commerce workflow advances or reworks that workflow's stages.

#### Scenario: Approval advances the task's own workflow

- **WHEN** the user adopts a deliverable of a task in a non-e-commerce workflow
- **THEN** the task advances along its own workflow's approved edge

#### Scenario: Rejection reworks the stage in the task's own workflow

- **WHEN** the user rejects a deliverable of a task in a non-e-commerce workflow
- **THEN** that task's stage returns to 进行中 for rework along its own workflow's rejected edge

### Requirement: Built-in workflow definitions sync on startup

The system SHALL treat the in-code built-in workflow definitions as the source of truth: on backend startup, each built-in workflow persisted in the database SHALL be compared against the code constant, and any divergence (missing, stale stage structure, changed approval points) SHALL be overwritten with the code definition and reported in the startup log. Custom workflow ids SHALL NOT be affected.

#### Scenario: Stale persisted definition is overwritten

- **WHEN** the backend starts and a built-in workflow's persisted graph diverges from the code constant (for example an approval point flag lost)
- **THEN** the persisted definition is overwritten with the code definition and a sync warning is logged

#### Scenario: Custom workflows are untouched

- **WHEN** the backend starts with a custom workflow id that is not one of the built-ins
- **THEN** that workflow's persisted definition is left as-is

### Requirement: Archiving requires a completed supervisor review

The system SHALL refuse to archive a task whose workflow contains a supervisor-review stage unless that stage has actually run: when the final stage completes without a REVIEW_PASSED event in the task's event log, the system SHALL roll the task back to the supervisor-review stage to re-run the review instead of archiving.

#### Scenario: Archiving without review rolls back

- **WHEN** a task reaches its final stage and the event log contains no REVIEW_PASSED for it
- **THEN** the task rolls back to the supervisor-review stage with a notice, instead of being archived

#### Scenario: Reviewed task archives normally

- **WHEN** the supervisor review has passed and the final stage completes
- **THEN** the task is archived with the review-stage owner as its owner
