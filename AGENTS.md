# AGENTS.md

## Version bump rule (mandatory)

When bumping versions in this repo, keep these values **in sync** to the exact same semver (for example `0.2.0`):

- `package.json` (repo root) → `version`
- `apps/logseq-shell/package.json` → `version`
- `apps/logseq-shell/logseq-plugin.edn` → `:version`
- `crates/logseq-shelld/Cargo.toml` → `package.version`
- Git tag for release → same version string (example: `0.2.0`)

Do not bump only one of them.
