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

The system SHALL allow mounting skills and files onto individual agents, scoped only to that agent. The mountable skill catalog SHALL be organized into **business-domain sections** — 电商 (e-commerce), 小红书 (XHS), 通用 (general) — and the mount picker SHALL render the skill area **grouped by these sections** rather than as one flat list. A section SHALL be omitted when it contains no mountable skill. A skill's section SHALL be derived from its location in the skills directory, and an optional declaration in the skill's own header SHALL override that derived value. When a skill declares a section the system does not recognize, the declared value SHALL be preserved and displayed rather than silently replaced with a default. Any skill file placed directly in the skills root SHALL be treated as 通用 so that existing flat layouts keep working. Every mountable skill SHALL carry a non-empty section, so that a skill can never surface without a section to group it under.

#### Scenario: Mount a skill to an agent

- **WHEN** user attaches a skill to an agent
- **THEN** the skill is listed on that agent's card and only that agent can use it

#### Scenario: Mount a file to an agent

- **WHEN** user attaches a file to an agent
- **THEN** the file is listed on that agent's card and only that agent can access it in its tasks

#### Scenario: Skill picker shows business-domain sections

- **WHEN** user opens the mount picker for an agent
- **THEN** the skill area renders one labeled group per non-empty section, ordered 电商 then 小红书 then 通用, with each group listing only the skills belonging to that section

#### Scenario: Section shows how many of its skills are mounted

- **WHEN** a section contains at least one skill already mounted on the agent
- **THEN** that section's label shows a mounted count in the form "已挂 N/M", where M is the number of skills in the section

#### Scenario: Every mountable skill has a section

- **WHEN** the mountable skill catalog is read
- **THEN** every skill reports a non-empty section, and a skill found directly in the skills root reports 通用

#### Scenario: Unrecognized declared section is preserved

- **WHEN** a skill declares a section the system does not recognize
- **THEN** the skill is presented under that declared value instead of being forced into a default section

#### Scenario: Mounted skill shows its section

- **WHEN** the mount picker lists the skills already mounted on the agent
- **THEN** each mounted skill displays its section as a badge next to its name

### Requirement: Mounted skill and file validity is visible

The system SHALL indicate, in the agent's mounted list, whether each mounted skill and file still resolves to an existing catalog entry. A mounted entry that no longer resolves SHALL be marked as invalid **in the same list**, in a visually distinct way, and SHALL remain removable. The system SHALL NOT present an unresolvable mount as if it were in effect.

The system SHALL seed agents only with mounts that resolve to an existing skill catalog entry or mounted file. Seeding SHALL NOT attach a skill or file whose only viable content is an empty fallback.

#### Scenario: Unresolvable mount is marked invalid

- **WHEN** an agent has a mounted skill that no longer exists in the skill catalog
- **THEN** that entry is displayed with an explicit invalid marker, distinguishable from a valid mount, and can still be removed by the user

#### Scenario: Resolvable mount shows no invalid marker

- **WHEN** every mounted skill of an agent resolves to a catalog entry
- **THEN** no entry in the mounted list carries the invalid marker

#### Scenario: Seeded mounts all resolve

- **WHEN** agents are seeded
- **THEN** every seeded skill resolves to an existing skill catalog entry and every seeded file resolves to an existing mounted file, so no agent starts with a mount that can only produce empty content

#### Scenario: Legacy file mounts migrate to a supported extension

- **WHEN** the backend starts against an existing database whose agent file mounts reference `.pdf` files that the mounted-file whitelist never supported
- **THEN** those references are replaced, once and idempotently, with their `.md` counterparts that exist in the mounted-file directory, and no other entries in the agent's file list are altered

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
