# Task Board

## Purpose

Defines the task board capability: a four-column Kanban (规划中 / 进行中 / 待确认 / 已完成) on the home page, a "new task" action in the top-right that requires user confirmation before AI starts, and task cards that move along the workflow.

## Requirements

### Requirement: Four-column task board

The system SHALL render the task board with four columns: 规划中 (planned), 进行中 (in progress), 待确认 (awaiting confirmation), 已完成 (completed). All four columns SHALL share the available width **equally**, so that at any container width every column is the same width as the others and a card's width is constant no matter which column it sits in. The columns SHALL respond to container size changes — when the side rails are collapsed/expanded, when the rail dividers are dragged, or when the browser window is resized, the columns SHALL re-flow to the new available width rather than overflowing it or leaving unused space. Each column SHALL honour a minimum width; when the available width cannot accommodate four columns at that minimum, the board container SHALL scroll horizontally instead of shrinking columns further. An empty column SHALL NOT be collapsed or compressed.

#### Scenario: Board shows four columns

- **WHEN** user opens the home page
- **THEN** the task board displays exactly the four columns 规划中 / 进行中 / 待确认 / 已完成

#### Scenario: Task moves along columns

- **WHEN** a task advances through its workflow
- **THEN** its card moves from 规划中 to 进行中, enters 待确认 at approval points, and lands in 已完成 after final approval

#### Scenario: Columns keep uniform width

- **WHEN** the board renders with a mix of empty and populated columns
- **THEN** every column has the same width and no column is rendered narrower than another

#### Scenario: Columns fill the available width

- **WHEN** the board renders inside a container wider than four columns' minimum width
- **THEN** the four columns together fill the container width, leaving no unused gap at the right edge

#### Scenario: Columns adapt to container size changes

- **WHEN** the user collapses or expands a side rail, drags a rail divider, or resizes the browser window
- **THEN** all four columns re-flow to the new available width while remaining equal to each other

#### Scenario: Board scrolls horizontally at minimum width

- **WHEN** the available width is smaller than four columns at their minimum width
- **THEN** the board scrolls horizontally and no column is rendered narrower than that minimum

#### Scenario: Empty column compressed

- **WHEN** a column contains no tasks
- **THEN** that column keeps the same width as columns containing tasks, and no freed width is redistributed

#### Scenario: Card width is constant across columns

- **WHEN** the same task card is viewed in a populated column and another card is viewed in a previously-empty column
- **THEN** both cards occupy the same width and their action buttons stay on a single line

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
- **THEN** the card does not show a second 「已交付 · 已完成」 row in addition to its status tag### Requirement: Create new task with confirmation

The system SHALL provide a "新建任务" button at the top-right of the board; creating a task collects task content and shows it for user confirmation before any agent starts working. Form validation messages SHALL appear only after the user has interacted with the form, so that opening the dialog does not immediately display error text.

#### Scenario: New task button opens creation form

- **WHEN** user clicks "+ 新建任务"
- **THEN** a creation form opens for entering product/task details

#### Scenario: No error text before interaction

- **WHEN** the creation form is opened and the user has not yet interacted with any field
- **THEN** no red validation message is displayed; only the neutral hint about confirmation before AI starts work is shown

#### Scenario: Validation appears after interaction

- **WHEN** the user edits the title, edits the description, toggles a platform, or picks a reference image, and the form is still incomplete
- **THEN** the specific blocking message (missing title / missing platform / missing reference image) is displayed in red

#### Scenario: Confirmation before starting

- **WHEN** user submits task content
- **THEN** the system displays the content summary for confirmation, and only after the user confirms does any agent begin work

#### Scenario: Task appears in 规划中

- **WHEN** a new task is created and confirmed
- **THEN** the task card appears in the 规划中 column

### Requirement: Open task status view

The system SHALL open the task status view (replacing the board view) when the user clicks a task card. Navigation to a task SHALL be reflected in the URL hash and SHALL survive browser back/forward navigation, page refresh, and link sharing.

#### Scenario: Click task card

- **WHEN** user clicks a task card on the board
- **THEN** the task status view opens with that task's details, workflow stages, pending confirmations, and workflow preview

#### Scenario: Browser back returns to board

- **WHEN** the user opens a task and then presses the browser back button
- **THEN** the app returns to the board view without a full reload

#### Scenario: Refresh keeps current view

- **WHEN** the user opens a task URL directly or refreshes the page on a task view
- **THEN** the app restores that task view and loads its details
