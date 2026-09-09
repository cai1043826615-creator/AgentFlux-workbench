## Purpose

Defines the overall three-column layout shell of the e-commerce agent workbench: a global top bar, a collapsible left sidebar for workflow cards and settings, and a collapsible right sidebar for chat.

## ADDED Requirements

### Requirement: Global top bar

The system SHALL render a persistent top bar containing: workspace group entry (工作群), private chat entry (私聊), task badge with unread count (任务 n), online-group dropdown (在岗 GROUP), and theme toggle.

#### Scenario: Top bar visible on every page

- **WHEN** user opens any page of the workbench
- **THEN** the top bar is always visible with 工作群, 私聊, 任务 badge, 在岗 GROUP dropdown and theme toggle

#### Scenario: Unread task badge

- **WHEN** there are pending approval items awaiting the user
- **THEN** the 任务 badge shows the count of pending items and is highlighted

### Requirement: Collapsible left sidebar

The system SHALL render a left sidebar that can collapse and expand, containing workflow cards (workflow presets) and a settings entry.

#### Scenario: Collapse and expand left sidebar

- **WHEN** user clicks the collapse arrow on the left sidebar
- **THEN** the sidebar hides, the main content area expands to fill the space, and a control remains to re-expand it

#### Scenario: Workflow card selection

- **WHEN** user clicks a workflow card in the left sidebar
- **THEN** the task board switches to that workflow's view and the selected card is highlighted

#### Scenario: Settings entry

- **WHEN** user clicks the settings icon in the left sidebar
- **THEN** the settings panel opens

### Requirement: Collapsible right chat sidebar

The system SHALL render a right chat sidebar that can collapse and expand, providing private chat and group chat access.

#### Scenario: Collapse and expand chat sidebar

- **WHEN** user clicks the collapse control on the right chat sidebar
- **THEN** the chat sidebar hides, the main content area expands, and a control remains to re-expand it

#### Scenario: Jump to private chat from workstation avatar

- **WHEN** user clicks an agent avatar in the workstation area
- **THEN** the right chat sidebar opens with that agent's private conversation focused
