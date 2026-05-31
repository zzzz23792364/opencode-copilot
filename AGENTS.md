<!-- CAT-CAFE-GOVERNANCE-START -->
> Pack version: 1.0.0

## Governance Rules

### Hard Constraints
- **opencode DB is read-only**: Never modify `~/.local/share/opencode/opencode.db` directly. All interactions go through `opencode` CLI.
- **Feishu secrets belong in .env**: Never commit App ID / App Secret to git. Use `.env` file (gitignored) or environment variables.
- **Bridge runs on Node.js**: Runtime dependency is Node.js >= 18. No Bun-only code paths.

### Quality Discipline
- **Spec before code**: Non-trivial features require a spec document in `docs/features/` or `docs/decisions/`.
- **E2E test before merge**: Run the bridge locally and send a test message on Feishu before pushing.
- **Bug fix requires root cause**: Reproduce → check logs → confirm root cause → fix. No guess-and-patch.
- **Done = verified**: "Done" means tested on real Feishu bot with real opencode session.

### Knowledge Engineering
- **YAML frontmatter** on all docs: `topics`, `doc_kind`, `created` required.
- **Three-layer info architecture**: README.md (overview) → docs/ (specs/decisions/features) → BACKLOG.md (roadmap tracking).
- **Feature lifecycle**: idea → decision → spec → implement → changelog
- **Archive, don't delete**: Outdated docs move to `docs/archive/`, never removed.

### Collaboration
- **Self-review is forbidden**: Use `git diff` review before commit, but major changes should be pair-reviewed.
- **Commit messages are documentation**: Describe what changed and why. Follow conventional commits style.
- **BRIDGE LOGS** at `~/.opencode-copilot/bridge.log` are the first place to look for issues.
<!-- CAT-CAFE-GOVERNANCE-END -->
