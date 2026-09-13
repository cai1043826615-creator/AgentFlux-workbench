## MODIFIED Requirements

### Requirement: Mount skills and files per agent

The system SHALL allow mounting skills and files onto individual agents, scoped only to that agent. The mountable skill catalog SHALL be organized into **business-domain sections** — 电商 (e-commerce), 小红书 (XHS), 通用 (general) — and the mount picker SHALL render the skill area **grouped by these sections** rather than as one flat list. A section SHALL be omitted when it contains no mountable skill. A skill's section SHALL be derived from its location in the skills directory, and an optional declaration in the skill's own header SHALL override that derived value. When a skill declares a section the system does not recognize, the declared value SHALL be preserved and displayed rather than silently replaced with a default. Any skill file placed directly in the skills root SHALL be treated as 通用 so that existing flat layouts keep working. Every mountable skill SHALL carry a non-empty section, so that a skill can never surface without a section to group it under.

#### Scenario: Mount a skill to an agent

- **WHEN** user attaches a skill to an agent
- **THEN** the skill is listed on that agent's card and only that agent can use it

#### Scenario: Mount a file to an agent

- **WHEN** user attaches a file to an agent
- **THEN** the file is listed on that agent's card and only that agent can access it in its tasks

#### Scenario: Skill picker shows business-domain sections

- **WHEN** user opens the mount picker for an agent
- **THEN** the skill area renders one labeled group per non-empty section, ordered 电商 then 小红书 then 通用, with each group listing only the skills belonging to that section

#### Scenario: Section shows how many of its skills are mounted

- **WHEN** a section contains at least one skill already mounted on the agent
- **THEN** that section's label shows a mounted count in the form "已挂 N/M", where M is the number of skills in the section

#### Scenario: Every mountable skill has a section

- **WHEN** the mountable skill catalog is read
- **THEN** every skill reports a non-empty section, and a skill found directly in the skills root reports 通用

#### Scenario: Unrecognized declared section is preserved

- **WHEN** a skill declares a section the system does not recognize
- **THEN** the skill is presented under that declared value instead of being forced into a default section

#### Scenario: Mounted skill shows its section

- **WHEN** the mount picker lists the skills already mounted on the agent
- **THEN** each mounted skill displays its section as a badge next to its name

## ADDED Requirements

### Requirement: Mounted skill and file validity is visible

The system SHALL indicate, in the agent's mounted list, whether each mounted skill and file still resolves to an existing catalog entry. A mounted entry that no longer resolves SHALL be marked as invalid **in the same list**, in a visually distinct way, and SHALL remain removable. The system SHALL NOT present an unresolvable mount as if it were in effect.

The system SHALL seed agents only with mounts that resolve to an existing skill catalog entry or mounted file. Seeding SHALL NOT attach a skill or file whose only viable content is an empty fallback.

#### Scenario: Unresolvable mount is marked invalid

- **WHEN** an agent has a mounted skill that no longer exists in the skill catalog
- **THEN** that entry is displayed with an explicit invalid marker, distinguishable from a valid mount, and can still be removed by the user

#### Scenario: Resolvable mount shows no invalid marker

- **WHEN** every mounted skill of an agent resolves to a catalog entry
- **THEN** no entry in the mounted list carries the invalid marker

#### Scenario: Seeded mounts all resolve

- **WHEN** agents are seeded
- **THEN** every seeded skill resolves to an existing skill catalog entry and every seeded file resolves to an existing mounted file, so no agent starts with a mount that can only produce empty content

#### Scenario: Legacy file mounts migrate to a supported extension

- **WHEN** the backend starts against an existing database whose agent file mounts reference `.pdf` files that the mounted-file whitelist never supported
- **THEN** those references are replaced, once and idempotently, with their `.md` counterparts that exist in the mounted-file directory, and no other entries in the agent's file list are altered
