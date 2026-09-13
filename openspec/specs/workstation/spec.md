# Workstation

## Purpose

Defines the workstation capability that manages agent workstations: each agent card shows persona, role, model, online status, and supports editing persona, mounting skills and files, with content isolated per agent.

## Requirements

### Requirement: Agent workstation cards

The system SHALL render a workstation area displaying one card per agent, each card showing avatar, agent name, configured model, job role, and online status. The workstation area SHALL be **expanded by default**. When collapsed, it SHALL present an **avatar row** in which every agent shows a small avatar with its status dot together with the agent's **name and job role**, so the collapsed form remains identifiable without expanding. The collapsed row SHALL remain a single compact row that gives vertical space back to the main view.

The workstation area SHALL render **only the workflow crew** (文案 / 设计师 / 主管). The knowledge-base assistant agent (role 助理) SHALL NOT be rendered in the workstation area — the workstation's semantics are the workflow crew, and the assistant does not participate in the workflow. The assistant SHALL instead appear in the knowledge overview bar via the shared agent-card component.

#### Scenario: Display agent cards

- **WHEN** user opens the workstation area
- **THEN** each configured agent (文案, 设计师, 主管) is shown as a card with avatar, name, model, role and status

#### Scenario: Show online status

- **WHEN** an agent is processing a task
- **THEN** its card shows an online indicator with activity state (e.g. "正在" or "上次活跃 n 分钟前")

#### Scenario: Workstation expanded by default

- **WHEN** user opens the board page for the first time in a session
- **THEN** the workstation area renders in its expanded form showing the full agent cards

#### Scenario: Collapsed form shows avatar with name and role

- **WHEN** user collapses the workstation area
- **THEN** each agent appears as a small avatar with its status dot, followed by the agent's name and job role

#### Scenario: Collapsed form stays compact

- **WHEN** the workstation area is collapsed
- **THEN** it occupies a single row of reduced height, returning the freed vertical space to the main view

#### Scenario: Assistant agent excluded from workstation

- **WHEN** the knowledge-base assistant agent exists
- **THEN** the workstation area shows exactly three cards (文案 / 设计师 / 主管) and the assistant is not rendered there


### Requirement: Agent persona editing

The system SHALL allow the user to edit each agent's persona (人设), including role description and behavioral instructions.

#### Scenario: Edit agent persona

- **WHEN** user opens the edit dialog for an agent and saves a new persona
- **THEN** the agent's persona is updated and persists across sessions

### Requirement: Mount skills and files per agent

The system SHALL allow mounting skills and files onto individual agents, scoped only to that agent.

#### Scenario: Mount a skill to an agent

- **WHEN** user attaches a skill to an agent
- **THEN** the skill is listed on that agent's card and only that agent can use it

#### Scenario: Mount a file to an agent

- **WHEN** user attaches a file to an agent
- **THEN** the file is listed on that agent's card and only that agent can access it in its tasks

### Requirement: Per-agent content isolation

The system SHALL isolate content, skills, files, and contexts between agents so that one agent cannot see another agent's private materials.

#### Scenario: Content isolation between agents

- **WHEN** two agents are configured with different mounted files and skills
- **THEN** each agent only sees its own mounted content and none of the other agent's

### Requirement: Per-agent model configuration

The system SHALL allow each agent to be configured with an independent AI model.

#### Scenario: Configure different models

- **WHEN** the user sets model A for the 文案 agent and model B for the 设计师 agent
- **THEN** each agent uses its own configured model for its tasks

### Requirement: Online status and activity

The system SHALL display whether each agent is online, busy, or idle, and update the status as the agent works.

#### Scenario: Status update while working

- **WHEN** an agent begins processing a task
- **THEN** its workstation card status changes to online/busy with current activity
