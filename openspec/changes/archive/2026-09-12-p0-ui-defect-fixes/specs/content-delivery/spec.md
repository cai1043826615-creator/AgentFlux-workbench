## MODIFIED Requirements

### Requirement: Copy package preview

The system SHALL render the copy deliverable (标题, 5 核心卖点, 详情文案大纲, 关键词清单) as a formatted card when the 卖点文案 stage has output. The card SHALL present the **current version's** content first and without competing visual weight. Version history SHALL NOT appear above the current content: it SHALL be reachable from a control placed on the current content's header, SHALL be collapsed by default, and SHALL expand in place below the current content when activated. When the deliverable has no reference image, the delivery view SHALL display copy that states the output is AI-generated without a reference image, and MUST NOT claim the output is based on a reference image.

#### Scenario: View copy package card

- **WHEN** the 卖点文案 stage has output and is awaiting or approved
- **THEN** the copy package is displayed as a card with title, five core selling points, detail outline, and keywords

#### Scenario: Current version reads first

- **WHEN** user opens the content delivery view for a task whose deliverable has more than one version
- **THEN** the current version's content appears above any version history, and no historical version preview is expanded by default

#### Scenario: Version history is collapsed by default

- **WHEN** the content delivery view renders a deliverable that has version history
- **THEN** only a collapsed history control is visible on the current content's header, and the historical content is not rendered expanded

#### Scenario: Version history expands in place

- **WHEN** user activates the collapsed history control
- **THEN** the history panel expands below the current content, and the current content remains above it

#### Scenario: Copy reflects absence of reference image

- **WHEN** a task has no user-uploaded reference image
- **THEN** the delivery view states that images are AI-generated without a reference image, and does not display copy claiming generation is based on a reference image

#### Scenario: Copy reflects presence of reference image

- **WHEN** a task has a user-uploaded reference image
- **THEN** the delivery view states that AI output is generated based on the reference image
