## MODIFIED Requirements

### Requirement: Six-stage workflow definition

The system SHALL define the e-commerce listing workflow as six ordered stages: 需求对齐, 卖点文案, 主图设计, 详情图设计, 主管校对, 交付完成, with 主管校对 followed by an automatic 交付完成 stage (no human confirmation at the end — the supervisor review passing directly archives the task). This workflow SHALL be one of the registered workflows, identified by its own workflow id, and SHALL remain the default workflow for tasks that do not specify one.

#### Scenario: Workflow stages shown in status view

- **WHEN** user opens a task status view
- **THEN** the workflow progress bar shows the six stages in order with the current stage highlighted

#### Scenario: Existing e-commerce tasks keep the e-commerce workflow

- **WHEN** a task created before another workflow existed is opened
- **THEN** it is resolved against the e-commerce workflow and its six stages render unchanged

## ADDED Requirements

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
