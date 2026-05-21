# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses conventional commits.

## [Unreleased]

## [2.0.0] - 2026-05-21

### Breaking

- Hard-switched the role schema to v2 and removed the legacy schema activation path.
- Reading `SKILL.md` is no longer the activation path; use `skill activate` instead.

### Added

- Added the `skill` tool for explicit skill activation.
- Added the system-prompt template for the v2 role flow.
- Added ask UX with a picker for user-mediated prompts.
- Added `roles.ask.primaryToolArgs` for configuring primary ask-tool arguments.

### Changed

- Changed the internal `ResolvedRole` shape to support the v2 runtime contract.

### Migration

- See [docs/migration-v2.md](docs/migration-v2.md) for migration guidance.

## [0.2.1] - 2026-05-20

### Fixed

- Strip `temperature` from already-built provider payloads for blacklisted provider/model globs instead of only skipping new injection, making `roles.temperatureBlacklist` reliable for providers like `openai-codex/*`.

### Added

- Added regression coverage for role temperature payload handling, including payloads that already contain top-level or nested `temperature` fields before the extension hook runs.

## [0.2.0] - 2026-05-20

### Added

- Added `/role:reload` to rescan role files and reapply runtime role state without reloading the whole pi runtime.
- Added example-role coverage for the new `brainstormer` role plus a live-test role pack under `examples/roles/`.

## [0.1.4] - 2026-05-20

### Added

- Added `roles.temperatureBlacklist` with a sane default of `["openai-codex/*"]` so provider/model globs that reject `temperature` do not receive it.

### Fixed

- Prevented role-level `temperature` from being forwarded to blacklisted providers such as `openai-codex/*`, avoiding `Unsupported parameter: temperature` errors.

## [0.1.3] - 2026-05-20

### Fixed

- Stopped injecting `<role-state>` as a synthetic context message and now append it directly to the outgoing provider payload, preventing hidden role-state blocks from leaking back into the conversation stream.

## [0.1.2] - 2026-05-20

### Fixed

- Stopped showing the fallback `[Role: ...]` widget when `pi-fancy-editor` is active by replacing the broken event-listener-count heuristic with an explicit fancy-editor readiness signal.

### Changed

- Event-bus subscriptions now use the public pi event-bus unsubscribe contract instead of assuming Node `EventEmitter` methods are available.

## [0.1.1] - 2026-05-20

### Changed

- Renamed the LLM-callable role switch tool from `role:switch` to `role_switch` because pi tool names only accept letters, numbers, underscores, and hyphens.
- Hardened hex color rendering so fallback role colors also work under the pi test harness mock theme.

### Added

- Added harness coverage for end-to-end role switching, prompt/tool filtering, and provider payload temperature forwarding.
- Added sandbox install verification that packs the package, installs it into a temporary project, and smoke-tests the installed extension.

## [0.1.0] - 2026-05-20

### Added

- Added the initial `@furbyhaxx/pi-agent-roles` package scaffold with npm publish metadata, peer dependencies, tests, changelog, and sane git ignore rules.
- Added role discovery from global and project roots plus optional configured roots under the `roles` settings key.
- Added a built-in fallback `builder` role plus stable cached display colors for roles without explicit colors.
- Added branch-aware role state persistence, sticky-lock handling, queued user role switches, and live role restoration on `session_start` and `session_tree`.
- Added prompt filtering for hidden skills, live `<role-state>` context injection, and stable per-prompt Roles system prompt sections.
- Added runtime tool policy enforcement (`allow`, `ask`, `deny`) and the dynamic `role_switch` tool.
- Added `/role:manage`, `/role:unstick`, and configurable role cycling via shortcut.
- Added responsive role manager UI with a wide two-pane layout and a compact narrow-terminal layout.
- Added `pi-fancy-editor` event-bus integration plus below-editor widget fallback when fancy-editor is unavailable.
- Added the bundled `role-creator` skill exposed dynamically through `resources_discover`.
- Added unit coverage for config loading, discovery, state reconstruction, prompt shaping, tool policy, and role display helpers.
