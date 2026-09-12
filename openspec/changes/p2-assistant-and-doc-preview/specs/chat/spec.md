## MODIFIED Requirements

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
