## MODIFIED Requirements

### Requirement: Pending approve/reject actions only

The system SHALL provide approve (采纳) and reject (打回) actions on a delivered item **only while it is pending**; once an item is decided (approved or rejected), its action buttons MUST disappear and only a status badge (✓ 已采纳 / ✗ 已打回) remains. For a task awaiting confirmation, the approval bar SHALL **host the approve/reject actions** for the pending item rather than only explaining where those actions live, and its explanatory text SHALL be a **single short line** stating the state and the consequence of approving. The approval bar SHALL NOT render a long sentence describing where the buttons are located.

#### Scenario: Approve hides buttons

- **WHEN** user clicks 采纳 on a pending copy package or image
- **THEN** the item is marked approved, its 采纳/打回 buttons disappear, and a "已采纳 ✓" status is shown instead

#### Scenario: Decided item shows status only

- **WHEN** a delivered item is already approved or rejected
- **THEN** the item shows only its status badge and no approve/reject buttons

#### Scenario: Approval bar hosts the decision actions

- **WHEN** a task is awaiting the user's confirmation
- **THEN** the approval bar presents the 采纳 / 打回 actions for the pending item, so the user does not have to hunt for them inside the content card

#### Scenario: Approval bar text is a single short line

- **WHEN** the approval bar renders
- **THEN** its explanatory text is one short line (e.g. 「待你确认 · 采纳后自动进入主图设计」) and does not span a long explanatory sentence across the full bar width

#### Scenario: Approval still advances the workflow

- **WHEN** the user approves from the approval bar
- **THEN** the workflow advances exactly as before, and rejecting still routes the item back for rework
