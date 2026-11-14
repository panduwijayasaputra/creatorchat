---
name: "source-command-status"
description: "Check the current status of the agile team's work"
---

# source-command-status

Use this skill when the user asks to run the migrated source command `status`.

## Command Template

Read the following files and provide a status dashboard:

1. `.agile/backlog-index.json` — Index of all stories
2. `.agile/sprint.json` — Items currently in progress or blocked
3. `.agile/completed.json` — Recently completed items

For stories that are `in_progress`, `developed`, or `tested`, also read the story markdown files from `.agile/features/` to show task-level detail.

Provide a summary in this format:

## Team Status

### Backlog
Stories with status `backlog`:
- **US-XXX**: Title (Priority: high/medium/low)

### Planned
Stories with status `planned` (ready for `/dev-team`):
- **US-XXX**: Title (Priority: high/medium/low)

### In Progress
Stories with status `in_progress`:
- **US-XXX**: Title
  - TASK-XXX: description — `status`
  - TASK-XXX: description — `status`

### Blocked
Tasks with status `blocked` or `qa_failed`:
- **TASK-XXX** (US-XXX): Reason for block
  - Retries attempted: N
  - Issue: brief description

### Ready for UAT
Stories with status `ready_for_uat`:
- **US-XXX**: Title

### Completed
Last 5 items from completed.json:
- **US-XXX**: Title — completed at [timestamp]

### Progress Summary
- **Total stories**: X
  - Backlog: Y
  - Planned: Z
  - In Progress: W
  - Ready for UAT: V
  - Done: U
- **Completion rate**: percentage

### Phases
Group stories by `phase` (A Foundation, B Profiles & applications, C Access & manual chat, D Media, E Broadcast & notifications, F AI, G Admin completion, H Pilot hardening):
- **Phase X**: N stories (breakdown by status)

### Features
Group stories by feature:
- **feature-name**: X stories (breakdown by status)

### Alerts
- Flag stories without tasks (need `/tech-lead`)
- Flag blocked tasks with reasons
- Note if sprint.json has empty in_progress (team idle)
- Warn if backlog items exist but nothing is planned
- Note any `qa_failed` tasks
- Flag stories planned out of phase order (e.g. phase D work while phase A is incomplete)
- Flag tasks blocked on missing inputs: Claude Design export, credentials, AI provider, upload limits (see `.agile/guidelines/codebase-map.md` and the decisions log in `.agile/guidelines/tech-stack.md`)

### Recommendations
Based on the status, suggest next actions:
- If backlog is empty: suggest `/po` for the next phase in `.agile/.doc/Claude_Code_Project_Brief_and_Guide.md` §16
- If stories in backlog: suggest `/tech-lead` to plan them (earliest phase first)
- If stories planned: suggest `/dev-team` to start development
- If blocked items: suggest reviewing the block reasons
- If ready for UAT: suggest user testing
