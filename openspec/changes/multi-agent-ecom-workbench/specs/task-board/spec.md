## Purpose

Defines the task board capability: a four-column Kanban (规划中 / 进行中 / 待确认 / 已完成) on the home page, a "new task" action in the top-right that requires user confirmation before AI starts, and task cards that move along the workflow.

## ADDED Requirements

### Requirement: Four-column task board

The system SHALL render the task board with four columns: 规划中 (planned), 进行中 (in progress), 待确认 (awaiting confirmation), 已完成 (completed).

#### Scenario: Board shows four columns

- **WHEN** user opens the home page
- **THEN** the task board displays exactly the four columns 规划中 / 进行中 / 待确认 / 已完成

#### Scenario: Task moves along columns

- **WHEN** a task advances through its workflow
- **THEN** its card moves from 规划中 to 进行中, enters 待确认 at approval points, and lands in 已完成 after final approval

### Requirement: Task card content

The system SHALL render each task card with title, current stage label, responsible agent, and status tag (e.g. "卖点文案 · 文案Agent 在写 20m"; agent display names are editable in workstation, prototype uses 美美/平平/波波).

#### Scenario: Card shows agent and status

- **WHEN** an agent is processing a task
- **THEN** the card shows the agent name and a live status tag

### Requirement: Create new task with confirmation

The system SHALL provide a "新建任务" button at the top-right of the board; creating a task collects task content and shows it for user confirmation before any agent starts working.

#### Scenario: New task button opens creation form

- **WHEN** user clicks "+ 新建任务"
- **THEN** a creation form opens for entering product/task details

#### Scenario: Confirmation before starting

- **WHEN** user submits task content
- **THEN** the system displays the content summary for confirmation, and only after the user confirms does any agent begin work

#### Scenario: Task appears in 规划中

- **WHEN** a new task is created and confirmed
- **THEN** the task card appears in the 规划中 column

### Requirement: Open task status view

The system SHALL open the task status view (replacing the board view) when the user clicks a task card.

#### Scenario: Click task card

- **WHEN** user clicks a task card on the board
- **THEN** the task status view opens with that task's details, workflow stages, pending confirmations, and workflow preview
