## MODIFIED Requirements

### Requirement: Four-column task board

The system SHALL render the task board with four columns: 规划中 (planned), 进行中 (in progress), 待确认 (awaiting confirmation), 已完成 (completed). Empty columns SHALL be rendered at a compressed width so that columns holding tasks receive more horizontal space.

#### Scenario: Board shows four columns

- **WHEN** user opens the home page
- **THEN** the task board displays exactly the four columns 规划中 / 进行中 / 待确认 / 已完成

#### Scenario: Task moves along columns

- **WHEN** a task advances through its workflow
- **THEN** its card moves from 规划中 to 进行中, enters 待确认 at approval points, and lands in 已完成 after final approval

#### Scenario: Empty column compressed

- **WHEN** a column contains no tasks
- **THEN** that column is rendered narrower than columns containing tasks, and the freed width is given to the populated columns

### Requirement: Task card content

The system SHALL render each task card with title, current stage label, responsible agent, and status tag. The card SHALL render its primary action on its own full-width row, with secondary actions collected into an overflow menu; button labels SHALL NOT wrap onto multiple lines. A card in the 已完成 column SHALL expose an entry point to view its deliverables.

#### Scenario: Card shows agent and status

- **WHEN** an agent is processing a task
- **THEN** the card shows the agent name and a live status tag

#### Scenario: Primary action occupies its own row

- **WHEN** user views a task card
- **THEN** the primary action button spans its own row and secondary actions are reachable only through the overflow menu

#### Scenario: Button labels never wrap

- **WHEN** a button label is long (e.g. 「确认开工」) and space is tight
- **THEN** the label stays on a single line rather than breaking across two lines

#### Scenario: Completed card exposes deliverables entry

- **WHEN** a task is in the 已完成 column
- **THEN** its card shows an entry point that opens the task's deliverables

### Requirement: Create new task with confirmation

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
