# User Instructions

- When you learn something reusable while working in a project, record it in the `Lessons` section of the repo-level `AGENTS.md` at the repository root. This includes library versions, model names, project conventions, corrected assumptions, and fixes for mistakes. Do not write these lessons to the user-level global files under `~/.omp/agent/`.
- Docker-published Compose ports can bypass expected UFW `deny incoming` behavior through Docker iptables chains; local/dev service ports should bind explicitly to `127.0.0.1` in `ports` mappings on cloud hosts unl
ess public exposure is intended.
