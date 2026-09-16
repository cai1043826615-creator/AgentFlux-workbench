## MODIFIED Requirements

### Requirement: Mounted skill and file validity is visible

The system SHALL indicate, in the agent's mounted list, whether each mounted skill and file still resolves to an existing catalog entry. **Before** an unresolvable entry is marked invalid, the system SHALL attempt to follow a rename or move of its target. The system SHALL maintain a persisted catalog snapshot holding each catalog entry's content fingerprint, and SHALL use the snapshot taken **before** the current index build as the comparison baseline. When a mount's recorded reference no longer resolves while the baseline holds that reference's former content fingerprint and **exactly one** current catalog entry carries the same content fingerprint, the system SHALL silently rewrite the mount to that entry's new reference. The rewrite SHALL cover the per-workflow mount parts and the derived union fields together, and SHALL NOT leave a duplicate entry where the same mount target is already present. The system SHALL NOT follow when the fingerprint match is ambiguous (more than one candidate), when no candidate exists, or when the baseline holds no fingerprint for that reference, and SHALL NOT match by name similarity, modification time, or directory proximity. Following SHALL NOT introduce any user-facing control, prompt, notice, or setting; a silently followed mount SHALL NOT be presented as invalid. A mounted entry that no longer resolves after the follow attempt SHALL be marked as invalid **in the same list**, in a visually distinct way, and SHALL remain removable. The system SHALL NOT present an unresolvable mount as if it were in effect.

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

#### Scenario: Renamed mounted skill is followed silently

- **WHEN** a mounted skill file is renamed without changing its content, and the skill catalog is rebuilt
- **THEN** the mount is rewritten to the new file name, no invalid marker is shown for it, and no user-facing notice is presented

#### Scenario: Moved mounted file is followed silently

- **WHEN** a mounted Vault document is moved to another directory without changing its content, and the knowledge index is rebuilt
- **THEN** the mount is rewritten to the new relative path, and the mounted file resolves again

#### Scenario: Ambiguous fingerprint match is not followed

- **WHEN** a mounted target no longer resolves and more than one current catalog entry carries the same content fingerprint
- **THEN** no mount is rewritten and the entry keeps its invalid marker

#### Scenario: Rename combined with a content edit is not followed

- **WHEN** a mounted target is renamed and its content is also edited before the catalog is rebuilt
- **THEN** no mount is rewritten and the entry keeps its invalid marker

#### Scenario: Deletion is not mistaken for a rename

- **WHEN** a mounted target is deleted and no current entry matches its former content fingerprint
- **THEN** no other mount is rewritten and the deleted entry keeps its invalid marker
