---
name: logseq-local-http
description: "Interact with a local Logseq graph through the HTTP API at http://127.0.0.1:12315 by sending authenticated POST /api requests with plugin SDK method names and args. Use when tasks need to search notes, retrieve related/backlinked pages, find journal notes by day or topic, or traverse page/block links in a local Logseq graph. Prefer graph-aware reading: read current page, then linked references from recent to old, then latest journals before concluding."
---

# Logseq Local HTTP

## Overview
Use this skill to query and analyze a local Logseq graph through the Logseq HTTP API server.

## Quick Start
1. Always run:
```bash
python3 scripts/logseq_http.py --help
```
before any other command to confirm command availability.
2. Confirm Logseq HTTP server is running at `http://127.0.0.1:12315/`.
3. Get the API token from Logseq settings and export it:
```bash
export LOGSEQ_TOKEN="your-token"
export LOGSEQ_BASE_URL="http://127.0.0.1:12315"   # optional
```
4. Run a quick connectivity check:
```bash
python3 scripts/logseq_http.py call --method logseq.Editor.getCurrentPage
```
5. If you get `401 Unauthorized`, generate a new token in Logseq: Open Logseq → Settings → API Access (or Local HTTP API), create/copy a fresh token, then set it:
```bash
export LOGSEQ_TOKEN="your-new-token"
```
Then rerun the helper commands.

## API Contract
Use `POST /api` with these headers:
- `Content-Type: application/json`
- `Authorization: Bearer <token>`

Body format:
```json
{
  "method": "logseq.Editor.getPage",
  "args": ["My Page"]
}
```

## Default Reading Strategy
Do not conclude from a single page unless the user explicitly asks for narrow scope.

Use this sequence:
1. Read current page (or requested page) blocks.
2. Read linked references and prioritize recent-to-old.
3. Read recent journal pages to capture latest context shifts.
4. Synthesize across all three sources and then answer.

## Core Tasks

### Build graph-aware context first
Use this before deeper analysis:
```bash
python3 scripts/logseq_http.py context --output compact --linked-limit 40 --journal-limit 7 --journal-days 30
```

Use explicit page instead of current page:
```bash
python3 scripts/logseq_http.py context --page "Project Alpha" --output compact
```

### Search notes
Use the helper for title + block-content search:
```bash
python3 scripts/logseq_http.py search --query "project alpha" --output compact --limit 20
```

How it works:
1. Call `logseq.Editor.getAllPages`.
2. Match query against page names/titles.
3. Call `logseq.Editor.getPageBlocksTree` per page and match block content.

Control response size:
- `--limit 20` (alias `--max-results`) caps returned matched pages.
- `--offset 20` paginates to the next page of matches.
- `--max-block-hits-per-page 3` caps hit blocks per page.
- `--output compact|names|full` controls payload detail (`names` keeps page + IDs + counts).
- `--format outline` prints compact, human-readable output.
- `--format jsonl` prints one JSON object per line.
- `--compact-json` prints one-line JSON for piping.

### Retrieve related pages
Use backlinks + outgoing links:
```bash
python3 scripts/logseq_http.py related --page "Project Alpha"
```

How it works:
1. Call `logseq.Editor.getPageLinkedReferences` for backlinks.
2. Call `logseq.Editor.getPageBlocksTree` and extract `[[Page]]` links for outgoing links.
3. Optionally call `logseq.Editor.getPagesFromNamespace` for namespace neighbors.

### Find notes from a particular day
Use a date in `YYYY-MM-DD`:
```bash
python3 scripts/logseq_http.py journal --date "2026-03-02"
```

How it works:
1. Convert date to journal day integer `YYYYMMDD`.
2. Call `logseq.Editor.getAllPages`.
3. Filter pages where journal flag is true and `journalDay` matches.
4. Load page blocks with `logseq.Editor.getPageBlocksTree`.

### Find notes by topic
Use a topic/page/tag name:
```bash
python3 scripts/logseq_http.py topic --name "machine-learning"
```

How it works:
1. Treat topic as a page/tag and call `logseq.Editor.getPageLinkedReferences`.
2. Call `logseq.Editor.getTagObjects` and match tag names.

### Traverse the note graph
Run bounded BFS from a seed page:
```bash
python3 scripts/logseq_http.py traverse --start-page "Project Alpha" --depth 2 --max-nodes 120
```

How it works:
1. Neighbors come from outgoing `[[Page]]` links and backlink sources.
2. BFS expands by depth with a visited set and node cap.
3. Returns JSON with `nodes` and `edges`.

## Method Reference
Read [references/logseq-http-recipes.md](references/logseq-http-recipes.md) for method lists and request templates.

## Script Reference
Use [scripts/logseq_http.py](scripts/logseq_http.py) for all API calls and reusable workflows instead of rewriting request code each time.
