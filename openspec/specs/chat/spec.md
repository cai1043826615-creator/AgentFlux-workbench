# Chat

## Purpose

Defines the chat capability: private one-to-one chat with each agent, a group chat containing all agents, and event notifications pushed to the group when a stage completes, when the supervisor review runs, and when human approval is requested.

## Requirements

### Requirement: Private chat with agents

The system SHALL allow the user to chat privately with any individual agent, including the knowledge-base assistant (role 助理). The private-chat object list SHALL include the assistant alongside the workflow crew, and a conversation with the assistant SHALL behave like any other private conversation (isolated messages, per-agent session).

#### Scenario: Open private chat

- **WHEN** user clicks an agent's avatar in the workstation or selects 私聊 in the top bar
- **THEN** the right chat sidebar opens a private conversation with that agent

#### Scenario: Private messages are isolated

- **WHEN** user sends a message in a private chat
- **THEN** the message is visible only in that private conversation and not in group chat

#### Scenario: Assistant is a private-chat object

- **WHEN** the knowledge-base assistant agent exists and the user opens the chat panel's private-chat object list
- **THEN** the assistant appears in the list with its avatar, name and role, and the user can open a private conversation with it

#### Scenario: Assistant not injected into group broadcasts

- **WHEN** a workflow event generates a group-chat announcement
- **THEN** the announcement attribution follows the existing workflow-role mapping only; the assistant neither sends nor is mentioned in workflow announcements


### Requirement: Group chat with all agents

The system SHALL provide a group chat containing the user and all agents.

#### Scenario: Open group chat

- **WHEN** user selects 工作群 in the top bar
- **THEN** the right chat sidebar opens the group conversation with all agents

### Requirement: Workflow event notifications in group

The system SHALL push notifications to the group chat when a workflow stage completes, when the supervisor review stage runs, and when human approval is requested.

#### Scenario: Stage completion event

- **WHEN** an agent completes a workflow stage
- **THEN** a notification message appears in the group chat describing the completed stage and its output

#### Scenario: Supervisor review event

- **WHEN** the 主管校对 stage is running
- **THEN** a notification appears in the group chat for the supervisor review

#### Scenario: Human approval event

- **WHEN** a human approval point is reached
- **THEN** a notification appears in the group chat asking the user to decide, alongside the approval prompt in the task status view
