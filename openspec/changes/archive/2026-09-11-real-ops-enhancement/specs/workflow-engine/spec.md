## MODIFIED Requirements

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

The system SHALL drive approval-point transitions from the per-item actions in the 内容交付 page: copy approve/reject at approval point 1 (卖点文案), and per-image approve/reject at approval point 2 (主图设计) and approval point 3 (详情图设计); the stage advances only after all pending images of the current set are decided.

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

The system SHALL automatically advance stages that have no human approval point, with zero manual intervention, and SHALL advance automatically from an approval point once the user's decision is made.

#### Scenario: Auto-progress requirement stage

- **WHEN** the 需求对接 stage completes
- **THEN** the system automatically continues to 卖点文案 without waiting for the user

#### Scenario: Auto-progress detail image stage

- **WHEN** the 详情图设计 stage completes and all its images are approved at approval point 3
- **THEN** the system automatically continues to 主管校对 without further manual intervention

#### Scenario: Auto-progress deliver stage

- **WHEN** the 交付归档 stage completes
- **THEN** the task is marked 已完成 and the workflow finishes
