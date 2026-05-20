# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses conventional commits.

## [Unreleased]

## [0.1.0] - 2026-05-20

### Added

- Added the initial `@furbyhaxx/pi-agent-roles` package scaffold with npm publish metadata, peer dependencies, tests, changelog, and sane git ignore rules.
- Added role discovery from global and project roots plus optional configured roots under the `roles` settings key.
- Added a built-in fallback `builder` role plus stable cached display colors for roles without explicit colors.
- Added branch-aware role state persistence, sticky-lock handling, queued user role switches, and live role restoration on `session_start` and `session_tree`.
- Added prompt filtering for hidden skills, live `<role-state>` context injection, and stable per-prompt Roles system prompt sections.
- Added runtime tool policy enforcement (`allow`, `ask`, `deny`) and the dynamic `role:switch` tool.
- Added `/role:manage`, `/role:unstick`, and configurable role cycling via shortcut.
- Added responsive role manager UI with a wide two-pane layout and a compact narrow-terminal layout.
- Added `pi-fancy-editor` event-bus integration plus below-editor widget fallback when fancy-editor is unavailable.
- Added the bundled `role-creator` skill exposed dynamically through `resources_discover`.
- Added unit coverage for config loading, discovery, state reconstruction, prompt shaping, tool policy, and role display helpers.
