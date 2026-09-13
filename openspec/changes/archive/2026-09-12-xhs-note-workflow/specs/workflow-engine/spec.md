## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Six-stage workflow definition

The system SHALL define the e-commerce listing workflow as six ordered stages: 需求对齐, 卖点文案, 主图设计, 详情图设计, 主管校对, 交付完成. This workflow SHALL be one of the registered workflows, identified by its own workflow id, and SHALL remain the default workflow for tasks that do not specify one.

#### Scenario: Workflow stages shown in status view

- **WHEN** user opens a task status view
- **THEN** the workflow progress bar shows the six stages in order with the current stage highlighted

#### Scenario: Existing e-commerce tasks keep the e-commerce workflow

- **WHEN** a task created before another workflow existed is opened
- **THEN** it is resolved against the e-commerce workflow and its six stages render unchanged

### Requirement: Task status view

The system SHALL provide a task status view replacing the board view, showing task summary, the workflow stage progress of that task's own workflow, pending confirmation items, and a task workflow preview.

#### Scenario: Status view content

- **WHEN** user opens the task status view
- **THEN** it shows the task summary, the stage progress of that task's own workflow, any pending confirmation items, and a workflow preview
