# Shell Layout

## Purpose

Defines the overall three-column layout shell of the e-commerce agent workbench: a global top bar, a collapsible left sidebar for workflow cards and settings, and a collapsible right sidebar for chat.

## Requirements

### Requirement: Global top bar

The system SHALL render a persistent top bar containing: logo, product name (电商工作台), task entry with a semantic pending-count badge, and real-time connection status. The top bar SHALL NOT render the browser-notification control (neither the toggle nor the permission-request button) — notification authorization SHALL live in the 运行设置 dialog instead. The top bar SHALL NOT render a marketing subtitle or an 「在岗 / 忙碌」 agent statistics readout. The pending-count badge SHALL NOT be a bare number; it SHALL carry its meaning in the visible label so a user can tell it apart from other task counts in the app.

#### Scenario: Top bar visible on every page

- **WHEN** user opens any page of the workbench
- **THEN** the top bar shows logo, 电商工作台, task entry and connection status, and no notification control, no 「MULTI-AGENT E-COMMERCE」 subtitle, nor 在岗/忙碌 counters

#### Scenario: Notification control absent from top bar

- **WHEN** user views the top bar on any page
- **THEN** no browser-notification checkbox and no 「开启通知」 button are rendered there

#### Scenario: Pending badge carries its meaning

- **WHEN** there are tasks awaiting the user's confirmation
- **THEN** the task entry shows a label identifying the count as pending items (e.g. 「7 待确认」) rather than a bare number

#### Scenario: Unread task badge

- **WHEN** there are pending approval items awaiting the user
- **THEN** the 任务 badge shows the count of pending items and is highlighted

#### Scenario: Pending badge derives from tasks

- **WHEN** the task board shows N tasks in the 待确认 column (excluding archived tasks)
- **THEN** the 任务 badge shows exactly N, matching the board's 待确认 column count

#### Scenario: Archived tasks excluded from badge

- **WHEN** a task in the 待确认 column is archived
- **THEN** the 任务 badge count decreases accordingly, consistent with the board column

#### Scenario: Quiet connection indicator when connected

- **WHEN** the real-time connection is established
- **THEN** the top bar shows a status dot only, without any text label

#### Scenario: Reconnect action when disconnected

- **WHEN** the real-time connection drops
- **THEN** the top bar replaces the status dot with a clickable 「已断开 · 点击重连」 control, and clicking it attempts to re-establish the connection immediately

#### Scenario: Connection state shared with chat panel

- **WHEN** the connection is restored from the top bar control
- **THEN** the chat panel observes the same connected state and stops showing its own disconnected hint

#### Scenario: Notification permission denied guidance

- **WHEN** browser notification permission is denied and the user views the notification section in 运行设置
- **THEN** an inline note appears explaining how to re-enable notifications via the address-bar site settings, with actionable steps, and the guidance remains non-blocking### Requirement: Collapsible left sidebar

The system SHALL render a left sidebar that can collapse and expand, containing workflow cards (workflow presets) and a 「运行设置」 entry. In the collapsed (rail) form, group labels SHALL be conveyed through per-icon tooltips rather than persistent text labels, placeholder workflow items SHALL NOT be rendered, and rail icons SHALL NOT be compressed or overlapped on narrow viewports.

#### Scenario: Collapse and expand left sidebar

- **WHEN** user clicks the collapse arrow on the left sidebar
- **THEN** the sidebar hides, the main content area expands to fill the space, and a control remains to re-expand it

#### Scenario: Workflow card selection

- **WHEN** user clicks a workflow card in the left sidebar
- **THEN** the task board switches to that workflow's view and the selected card is highlighted

#### Scenario: Settings entry

- **WHEN** user clicks the settings icon in the left sidebar
- **THEN** the settings panel opens

#### Scenario: Settings entry label

- **WHEN** user views the left sidebar in expanded form
- **THEN** the settings entry reads 「运行设置」

#### Scenario: Collapsed rail uses tooltips for grouping

- **WHEN** the left sidebar is collapsed into the icon rail
- **THEN** no persistent 「知识库 / 工作流 / 通用」 text labels are rendered, and hovering an icon reveals its group-qualified tooltip

#### Scenario: Placeholder workflows hidden in rail

- **WHEN** the left sidebar is collapsed into the icon rail
- **THEN** the disabled placeholder workflow items are not rendered

#### Scenario: Rail icons keep fixed size

- **WHEN** the viewport narrows while the rail is displayed
- **THEN** rail icons retain their fixed size and do not shrink or overlap

### Requirement: Collapsible right chat sidebar

The system SHALL render a right chat sidebar that can collapse and expand, providing private chat and group chat access. The sidebar SHALL default to collapsed on first load so the main view gets the full horizontal space, while remaining expandable by the user.

#### Scenario: Collapse and expand chat sidebar

- **WHEN** user clicks the collapse control on the right chat sidebar
- **THEN** the chat sidebar hides, the main content area expands, and a control remains to re-expand it

#### Scenario: Collapsed by default on first load

- **WHEN** user opens the workbench for the first time in a session
- **THEN** the right chat sidebar starts collapsed and the main view occupies the freed width

#### Scenario: Jump to private chat from workstation avatar

- **WHEN** user clicks an agent avatar in the workstation area
- **THEN** the right chat sidebar opens with that agent's private conversation focused
