## MODIFIED Requirements

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
