## MODIFIED Requirements

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
