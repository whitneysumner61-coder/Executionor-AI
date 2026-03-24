# Copilot skills

Repository-local Copilot skills live under `.github/skills/<skill-slug>/SKILL.md`.

## Create a new skill

Run:

```bash
npm run skill:new -- <skill-name>
```

Example:

```bash
npm run skill:new -- desktop-commander
```

That command will:

- create `.github/skills/<skill-slug>/`
- add `SKILL.md`
- prefill it from the repo template at `.github/skills/_template/SKILL.md.template`

## Helpful flags

```bash
npm run skill:new -- <skill-name> --dry-run
npm run skill:new -- <skill-name> --force
```

Use `--dry-run` to preview the generated content and `--force` to overwrite an existing skill file.

## Writing standard

- Keep skills specific to Executionor
- Focus on high-value usage, not generic theory
- Name the exact routes, files, panels, or workflows where the skill matters
- Prefer real verification steps over vague recommendations
