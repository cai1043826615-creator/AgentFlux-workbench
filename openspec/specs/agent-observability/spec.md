# Agent Observability

## Purpose

Defines the agent observability capability: recording each agent execution (duration, success/failure, error summary) and presenting execution statistics (run count, success rate, average duration) on workstation cards and in a statistics view, decoupled from business workflow events.

## Requirements

### Requirement: Agent execution logging

The system SHALL record one execution log entry per agent run, capturing agent id, task id, workflow stage, configured model, input/output summaries, duration, and result status.

#### Scenario: Log records execution

- **WHEN** an agent finishes processing a task step
- **THEN** an execution log entry is persisted with agent, task, stage, model, duration, result status, and error summary when applicable

#### Scenario: Failed execution recorded

- **WHEN** an agent execution fails (LLM error, timeout, invalid output)
- **THEN** the log entry records the failure status and error summary

### Requirement: Execution statistics

The system SHALL compute per-agent execution statistics: total runs, success count, success rate, and average duration, optionally broken down by workflow stage.

#### Scenario: Workstation card shows statistics

- **WHEN** user views an agent workstation card
- **THEN** the card shows the agent's run count, success rate, and average duration

#### Scenario: Statistics by stage

- **WHEN** user views execution statistics
- **THEN** statistics can be broken down by workflow stage (e.g. 卖点文案, 主图设计, 详情图设计)

### Requirement: Observability decoupled from business events

The system SHALL store execution logs separately from task business events (task_events), so operational details do not pollute the workflow activity log.

#### Scenario: Execution log independent of activity log

- **WHEN** an agent execution happens
- **THEN** the execution log entry is written without creating a task business event, unless the execution itself completes a workflow stage
