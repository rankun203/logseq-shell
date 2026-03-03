# Logseq HTTP Recipes

## Contents
- Authentication and endpoint
- Generic API call template
- Graph-first context workflow
- Search workflow
- Related pages workflow
- Day/topic workflow
- Graph traversal workflow
- Known response fields

## Authentication and endpoint
- Base URL: `http://127.0.0.1:12315`
- Endpoint: `POST /api`
- Header: `Authorization: Bearer <token>`

## Generic API call template
```json
{
  "method": "logseq.Editor.getPage",
  "args": ["Page Name"]
}
```

## Graph-first context workflow
Default order for understanding connected notes:
1. Current (or target) page.
2. Linked references sorted recent to old.
3. Recent journal pages.

Use command:
```bash
python3 scripts/logseq_http.py context --output compact --linked-limit 40 --journal-limit 7 --journal-days 30
```

Useful options:
- `--page "Page Name"` to anchor on a specific page.
- `--output compact|full` for summary vs raw payload.
- `--compact-json` for one-line payload.
- `--linked-limit` to cap reference fan-out.
- `--journal-limit` and `--journal-days` to bound journal scan.

## Search workflow
Use method set:
- `logseq.Editor.getAllPages`
- `logseq.Editor.getPageBlocksTree`

Recommended steps:
1. Fetch all pages once.
2. Match query against `name` and `originalName`.
3. For candidate pages (or all pages for full scan), fetch block trees.
4. Match query against each block `content`.

CLI size controls:
- `--limit`/`--max-results` for page-level result cap.
- `--offset` for pagination.
- `--max-block-hits-per-page` for block-hit cap.
- `--output compact|names|full` for detail level (`names` returns IDs without content excerpts).
- `--format outline` for compact human-readable output.
- `--format jsonl` for stream processing.
- `--compact-json` for single-line JSON.

## Related pages workflow
Use method set:
- `logseq.Editor.getPageLinkedReferences`
- `logseq.Editor.getPageBlocksTree`
- `logseq.Editor.getPagesFromNamespace` (optional)

Recommended steps:
1. Backlinks: call `getPageLinkedReferences(page)`.
2. Outgoing links: parse `[[Page]]` links from block content in `getPageBlocksTree(page)`.
3. Namespace adjacency: call `getPagesFromNamespace(page)` if relevant.

## Find notes by day
Use method set:
- `logseq.Editor.getAllPages`
- `logseq.Editor.getPageBlocksTree`

Recommended steps:
1. Convert date `YYYY-MM-DD` to `YYYYMMDD` integer.
2. Filter pages with journal flag (`journal?` or equivalent) and matching `journalDay`.
3. Fetch block tree for matched journal page(s).

## Find notes by topic
Use method set:
- `logseq.Editor.getPageLinkedReferences`
- `logseq.Editor.getTagObjects`

Recommended steps:
1. Treat topic as page/tag name.
2. Backlinks give all blocks mentioning the topic page.
3. Tag objects give existing tags and metadata.

## Graph traversal workflow
Use method set:
- `logseq.Editor.getPageBlocksTree`
- `logseq.Editor.getPageLinkedReferences`

Recommended steps:
1. BFS queue seeded with starting page.
2. For each page, collect neighbors from:
   - Outgoing links (`[[Page]]`) in its block tree.
   - Backlink sources from `getPageLinkedReferences`.
3. Keep `visited` set and `maxNodes` guard.
4. Return stable JSON: `nodes`, `edges`.

## Known response fields
Useful page fields often include:
- `name`
- `originalName`
- `journalDay`
- `journal?`

Useful block fields often include:
- `uuid`
- `content`
- `page`
- `children`

Handle field-name differences defensively because plugin/runtime versions can vary.
