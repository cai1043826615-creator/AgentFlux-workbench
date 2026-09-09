# Chat

## Purpose

Defines the chat capability: private one-to-one chat with each agent, a group chat containing all agents, and event notifications pushed to the group when a stage completes, when the supervisor review runs, and when human approval is requested.

## Requirements

### Requirement: Private chat with agents

The system SHALL allow the user to chat privately with any individual agent.

#### Scenario: Open private chat

- **WHEN** user clicks an agent's avatar in the workstation or selects 私聊 in the top bar
- **THEN** the right chat sidebar opens a private conversation with that agent

#### Scenario: Private messages are isolated

- **WHEN** user sends a message in a private chat
- **THEN** the message is visible only in that private conversation and not in group chat

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
