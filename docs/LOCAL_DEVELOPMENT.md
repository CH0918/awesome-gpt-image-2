# Local Development Guide

## Prerequisites

- Node.js 20+
- pnpm 9+

## Install Dependencies

```bash
pnpm install
```

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Clean issue data | `pnpm img2ai:clean` | Convert local prompt notes into cleaned issue JSON |
| Dry-run cleaning | `pnpm img2ai:clean:dry` | Preview cleaned issue JSON without writing final output |
| Issue to JSON | `pnpm img2ai:issue-to-json` | Convert one GitHub issue body into `data/my/approved/*.json` |
| Approved batch | `pnpm img2ai:approved-batch` | Convert all open approved prompt issues into local JSON |
| Generate README | `pnpm img2ai:generate` | Generate `README.md` from `data/my/approved/*.json` |

## Local README Generation

The current project flow is local-file based. Approved prompts are stored as JSON files under:

```text
data/my/approved/
```

Generate the README from those files:

```bash
pnpm img2ai:generate
```

The script reads `data/my/approved/*.json` and writes `README.md`.

## GitHub Issue Approval Flow

In GitHub Actions, approved issue processing is handled by:

```text
.github/workflows/img2ai-approved-issue-to-json.yml
```

When an issue has both `approved` and `prompt-submission` labels, the workflow converts it into local JSON, regenerates `README.md`, comments on the issue, and closes it.

## Notes

- The project no longer requires external CMS credentials.
- Do not add `CMS_HOST` or `CMS_API_KEY`; they are not used by the active local JSON workflow.
- The generated README is derived from repository files, so changes are auditable in git.
