## MODIFIED Requirements

### Requirement: Execution statistics

The system SHALL compute per-agent execution statistics: total runs, success count, success rate, and average duration, optionally broken down by workflow stage. Sub-panels that load execution data asynchronously SHALL render a loading skeleton while data is in flight, so that an empty layout is never mistaken for "no data". The Agent status page SHALL include the knowledge-base assistant (role 助理) as a monitored agent whose card and statistics reflect only its own invocations; statistics for the assistant SHALL NOT be folded into any workflow agent's numbers.

#### Scenario: Workstation card shows statistics

- **WHEN** user views an agent workstation card
- **THEN** the card shows the agent's run count, success rate, and average duration

#### Scenario: Statistics by stage

- **WHEN** user views execution statistics
- **THEN** statistics can be broken down by workflow stage (e.g. 卖点文案, 主图设计, 详情图设计)

#### Scenario: Loading skeleton for async sub-panels

- **WHEN** a sub-panel (task detail, knowledge, observability) is still loading its data
- **THEN** the panel shows a loading skeleton placeholder instead of an empty or "no data" state, and switches to real content once the data arrives

#### Scenario: Assistant appears on the status page with its own statistics

- **WHEN** the knowledge-base assistant agent exists and the user opens the Agent status page
- **THEN** the assistant appears as a status card with its own run count / success rate / average duration, counted separately from the workflow crew
