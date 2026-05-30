---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*)
description: Create a git commit then push
---

## Context

- Current git status: !`git status`
- Staged changes: !`git diff --cached`
- Unstaged changes: !`git diff`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10 2>/dev/null || echo "(no commits yet)"`

## Your task

Based on the above changes, create a single git commit and push to origin. The commit message must use conventional commit style (e.g. `feat(travel): ...`, `fix(farm): ...`) and should follow the repository's existing scope/message patterns when recent commits show them. Always include a substantive commit body explaining what the change does and why it is needed; do not use a subject-only commit message unless the diff is truly trivial.

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls unless any command fails. If any command fails, always report the failed command, exit code, and stderr before continuing. Do not add any Claude attribution in the commit message, including `Co-Authored-By: Claude ... <noreply@anthropic.com>` lines or generated-by footer text.
