## MODIFIED Requirements

### Requirement: Task card content

The system SHALL render each task card with title, current stage label, responsible agent, and status tag. The responsible agent SHALL be shown as an **avatar positioned at the card's top-right corner**, so the card does not spend a separate row on the agent identity. The card SHALL render its primary action on its own full-width row, with secondary actions collected into an overflow menu; button labels SHALL NOT wrap onto multiple lines. A card in the 已完成 column SHALL expose an entry point to view its deliverables. The card SHALL NOT render two elements that state the same status: where a status tag (badge) already conveys the state, the secondary line SHALL carry **complementary** information (such as how long the item has been waiting) rather than restating the badge, and a completed card SHALL NOT repeat its 「已交付 · 已完成」 state in a second row.

#### Scenario: Card shows agent and status

- **WHEN** an agent is processing a task
- **THEN** the card shows the agent's avatar at the top-right corner and a live status tag

#### Scenario: Agent avatar occupies the top-right corner

- **WHEN** user views any task card
- **THEN** the responsible agent's avatar is rendered at the card's top-right corner and no separate full-width row is spent on the agent name

#### Scenario: Avatar does not collide with card affordances

- **WHEN** a card is in the 待确认 column (which carries a status border) or shows the overflow menu
- **THEN** the top-right avatar stays inside the card's padding and does not overlap the border or the overflow menu control

#### Scenario: Primary action occupies its own row

- **WHEN** user views a task card
- **THEN** the primary action button spans its own row and secondary actions are reachable only through the overflow menu

#### Scenario: Button labels never wrap

- **WHEN** a button label is long (e.g. 「确认开工」) and space is tight
- **THEN** the label stays on a single line rather than breaking across two lines

#### Scenario: Completed card exposes deliverables entry

- **WHEN** a task is in the 已完成 column
- **THEN** its card shows an entry point that opens the task's deliverables

#### Scenario: Secondary line complements rather than repeats the badge

- **WHEN** a card's status tag already states the current state (e.g. 「待你确认 · 主图设计」)
- **THEN** the card's secondary line provides additional information (e.g. how long the task has been waiting) and does not restate the same state in different words

#### Scenario: Completed card does not repeat its state

- **WHEN** a task in the 已完成 column renders
- **THEN** the card does not show a second 「已交付 · 已完成」 row in addition to its status tag
