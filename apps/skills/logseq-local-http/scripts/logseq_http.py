#!/usr/bin/env python3
"""Helper CLI for interacting with Logseq local HTTP API."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import deque
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

LINK_RE = re.compile(r"\[\[([^\[\]]+)\]\]")


class LogseqApiError(RuntimeError):
    """Raised when Logseq API returns an error response."""


def _compact(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _load_json_list(raw: Optional[str]) -> List[Any]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON for --args: {exc}") from exc
    if not isinstance(value, list):
        raise ValueError("--args must be a JSON array")
    return value


def _truncate_text(text: str, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3].rstrip() + "..."


def _render_search_outline(payload: Dict[str, Any]) -> str:
    lines: List[str] = []
    pagination = payload.get("pagination") or {}
    lines.append(f"Query: {payload.get('query', '')}")
    lines.append(
        "Returned: "
        f"{pagination.get('returned', 0)} "
        f"(offset={pagination.get('offset', 0)}, limit={pagination.get('limit', 0)}, "
        f"has_more={pagination.get('has_more', False)})"
    )

    results = payload.get("results") or []
    if not results:
        lines.append("No matches.")
        return "\n".join(lines)

    for idx, item in enumerate(results, start=1):
        page = str(item.get("page", ""))
        page_id = str(item.get("page_id", "")).strip()
        hit_count = int(item.get("block_hit_count", 0))
        page_hit = bool(item.get("page_hit", False))
        suffix = " +title-hit" if page_hit else ""
        if page_id:
            lines.append(f"{idx}. {page} [{page_id}] ({hit_count} block hits{suffix})")
        else:
            lines.append(f"{idx}. {page} ({hit_count} block hits{suffix})")

        block_hits = item.get("block_hits")
        if not isinstance(block_hits, list):
            hit_ids = item.get("block_hit_ids")
            if isinstance(hit_ids, list) and hit_ids:
                lines.append(f"   - ids: {', '.join(str(x) for x in hit_ids)}")
            continue
        for hit in block_hits:
            if not isinstance(hit, dict):
                continue
            hit_id = str(hit.get("id") or hit.get("uuid") or "").strip() or "-"
            excerpt = str(hit.get("excerpt") or hit.get("content") or "").strip()
            if excerpt:
                lines.append(f"   - {hit_id}: {excerpt}")

    return "\n".join(lines)


def _post_json(url: str, token: str, payload: Dict[str, Any]) -> Any:
    data = _compact(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise LogseqApiError(f"HTTP {exc.code}: {detail.strip()}") from exc
    except urllib.error.URLError as exc:
        raise LogseqApiError(f"Request failed: {exc}") from exc

    if not body.strip():
        return None

    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def call_api(base_url: str, token: str, method: str, args: Optional[List[Any]] = None) -> Any:
    return _post_json(
        f"{base_url.rstrip('/')}/api",
        token,
        {
            "method": method,
            "args": args or [],
        },
    )


def _page_name(page: Dict[str, Any]) -> Optional[str]:
    for key in ("originalName", "name", "title"):
        value = page.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _entity_id(obj: Dict[str, Any]) -> Optional[str]:
    for key in ("uuid", "id", "uid"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _collect_candidates(container: Dict[str, Any], keys: Iterable[str]) -> Iterable[Any]:
    for key in keys:
        value = container.get(key)
        if value is not None:
            yield value


def _as_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if raw.isdigit():
            return int(raw)
    return None


def _as_epoch_seconds(value: Any) -> Optional[int]:
    parsed = _as_int(value)
    if parsed is None:
        if isinstance(value, str):
            try:
                dt_obj = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                return int(dt_obj.timestamp())
            except ValueError:
                return None
        return None

    # Heuristic: ms/us/ns timestamps are reduced to seconds.
    if parsed > 10_000_000_000_000_000:
        return parsed // 1_000_000_000
    if parsed > 10_000_000_000_000:
        return parsed // 1_000_000
    if parsed > 10_000_000_000:
        return parsed // 1_000
    return parsed


def _journal_day_to_date(value: int) -> Optional[dt.date]:
    try:
        return dt.datetime.strptime(str(value), "%Y%m%d").date()
    except ValueError:
        return None


def _extract_recency_score(item: Dict[str, Any]) -> Optional[int]:
    """
    Return epoch-seconds score for sorting refs from recent to old.
    Fallback to journal day if explicit timestamps are unavailable.
    """
    time_keys = (
        "updatedAt",
        "updated-at",
        "updated_at",
        "createdAt",
        "created-at",
        "created_at",
        "lastModifiedAt",
        "last-modified-at",
        "last_modified_at",
    )
    nested_keys = ("block", "page")

    for candidate in _collect_candidates(item, time_keys):
        ts = _as_epoch_seconds(candidate)
        if ts is not None:
            return ts

    for nk in nested_keys:
        nested = item.get(nk)
        if not isinstance(nested, dict):
            continue
        for candidate in _collect_candidates(nested, time_keys):
            ts = _as_epoch_seconds(candidate)
            if ts is not None:
                return ts

    day_keys = ("journalDay", "journal-day", "journal_day")
    for candidate in _collect_candidates(item, day_keys):
        jd = _as_int(candidate)
        if jd:
            d = _journal_day_to_date(jd)
            if d:
                return int(dt.datetime.combine(d, dt.time.min).timestamp())

    for nk in nested_keys:
        nested = item.get(nk)
        if not isinstance(nested, dict):
            continue
        for candidate in _collect_candidates(nested, day_keys):
            jd = _as_int(candidate)
            if jd:
                d = _journal_day_to_date(jd)
                if d:
                    return int(dt.datetime.combine(d, dt.time.min).timestamp())

    return None


def _block_summaries(blocks: Iterable[Dict[str, Any]], limit: int, excerpt_chars: int) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for block in iter_blocks(blocks):
        block_id = _entity_id(block)
        content = block.get("content")
        if not isinstance(content, str):
            continue
        items.append(
            {
                "id": block_id,
                "excerpt": _truncate_text(content, excerpt_chars),
            }
        )
        if len(items) >= limit:
            break
    return items


def _is_journal(page: Dict[str, Any]) -> bool:
    for key in ("journal?", "journal", "isJournal"):
        value = page.get(key)
        if isinstance(value, bool):
            return value
    return False


def _journal_day(page: Dict[str, Any]) -> Optional[int]:
    for key in ("journalDay", "journal-day", "journal_day"):
        value = page.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


def iter_blocks(blocks: Iterable[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
    stack = list(blocks or [])
    while stack:
        block = stack.pop()
        if isinstance(block, dict):
            yield block
            children = block.get("children") or []
            if isinstance(children, list):
                stack.extend(children)


def outgoing_links_from_blocks(blocks: Iterable[Dict[str, Any]]) -> Set[str]:
    links: Set[str] = set()
    for block in iter_blocks(blocks):
        content = block.get("content")
        if isinstance(content, str):
            for match in LINK_RE.findall(content):
                candidate = match.strip()
                if candidate:
                    links.add(candidate)
    return links


def backlink_pages(linked_refs: Any) -> Set[str]:
    pages: Set[str] = set()
    if not isinstance(linked_refs, list):
        return pages

    for item in linked_refs:
        if not isinstance(item, dict):
            continue

        page_obj = item.get("page")
        if isinstance(page_obj, dict):
            page = _page_name(page_obj)
            if page:
                pages.add(page)

        block = item.get("block")
        if isinstance(block, dict):
            block_page = block.get("page")
            if isinstance(block_page, dict):
                page = _page_name(block_page)
                if page:
                    pages.add(page)

    return pages


def cmd_call(args: argparse.Namespace) -> int:
    result = call_api(args.base_url, args.token, args.method, _load_json_list(args.args))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    if args.limit < 1:
        raise ValueError("--limit must be >= 1")
    if args.offset < 0:
        raise ValueError("--offset must be >= 0")
    if args.excerpt_chars < 8:
        raise ValueError("--excerpt-chars must be >= 8")
    if args.format != "json" and args.compact_json:
        raise ValueError("--compact-json is only valid with --format json")

    needle = args.query.lower()
    pages = call_api(args.base_url, args.token, "logseq.Editor.getAllPages", [])
    if not isinstance(pages, list):
        raise LogseqApiError("Unexpected response from logseq.Editor.getAllPages")

    results: List[Dict[str, Any]] = []
    scanned = 0
    matched = 0
    has_more = False

    for page in pages:
        if not isinstance(page, dict):
            continue

        name = _page_name(page)
        if not name:
            continue
        page_id = _entity_id(page)

        scanned += 1
        if scanned > args.max_pages:
            break

        page_hit = any(
            needle in str(page.get(k, "")).lower()
            for k in ("name", "originalName", "title")
        )

        blocks = call_api(args.base_url, args.token, "logseq.Editor.getPageBlocksTree", [name])
        block_hits = []
        if isinstance(blocks, list):
            for block in iter_blocks(blocks):
                content = block.get("content")
                if isinstance(content, str) and needle in content.lower():
                    block_id = _entity_id(block)
                    block_hits.append(
                        {
                            "id": block_id,
                            "uuid": block_id,
                            "content": content,
                        }
                    )
                    if len(block_hits) >= args.max_block_hits_per_page:
                        break

        if not (page_hit or block_hits):
            continue

        matched += 1
        if matched <= args.offset:
            continue

        item: Dict[str, Any] = {
            "page": name,
            "page_id": page_id,
            "page_hit": page_hit,
            "block_hit_count": len(block_hits),
        }
        if args.output == "full":
            item["block_hits"] = block_hits
        elif args.output == "compact":
            item["block_hits"] = [
                {
                    "id": hit.get("id"),
                    "excerpt": _truncate_text(str(hit.get("content", "")), args.excerpt_chars),
                }
                for hit in block_hits
            ]
        else:
            item["block_hit_ids"] = [hit.get("id") for hit in block_hits if hit.get("id")]

        results.append(item)
        if len(results) >= args.limit:
            has_more = True
            break

    payload = {
        "query": args.query,
        "output": args.output,
        "pagination": {
            "offset": args.offset,
            "limit": args.limit,
            "returned": len(results),
            "matched_scanned": matched,
            "has_more": has_more,
        },
        "results": results,
    }
    if args.format == "outline":
        print(_render_search_outline(payload))
    elif args.format == "jsonl":
        meta = {
            "type": "meta",
            "query": payload["query"],
            "output": payload["output"],
            "pagination": payload["pagination"],
        }
        print(_compact(meta))
        for item in results:
            print(_compact({"type": "result", **item}))
    else:
        if args.compact_json:
            print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        else:
            print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def _resolve_current_page(base_url: str, token: str) -> Dict[str, Any]:
    page = call_api(base_url, token, "logseq.Editor.getCurrentPage", [])
    if isinstance(page, dict):
        return page

    # Fallback when current page is unavailable in current Logseq focus context.
    block = call_api(base_url, token, "logseq.Editor.getCurrentBlock", [])
    if isinstance(block, dict):
        block_page = block.get("page")
        if isinstance(block_page, dict):
            return block_page

    raise LogseqApiError("Could not resolve current page (no current page/block context).")


def cmd_context(args: argparse.Namespace) -> int:
    if args.linked_limit < 1:
        raise ValueError("--linked-limit must be >= 1")
    if args.journal_limit < 1:
        raise ValueError("--journal-limit must be >= 1")
    if args.journal_days < 1:
        raise ValueError("--journal-days must be >= 1")
    if args.current_block_limit < 1:
        raise ValueError("--current-block-limit must be >= 1")
    if args.journal_block_limit < 1:
        raise ValueError("--journal-block-limit must be >= 1")
    if args.excerpt_chars < 8:
        raise ValueError("--excerpt-chars must be >= 8")

    if args.page:
        page_name = args.page
        page_obj = call_api(args.base_url, args.token, "logseq.Editor.getPage", [page_name])
        if isinstance(page_obj, dict):
            page_name = _page_name(page_obj) or page_name
            page_id = _entity_id(page_obj)
        else:
            page_id = None
    else:
        current = _resolve_current_page(args.base_url, args.token)
        page_name = _page_name(current)
        if not page_name:
            raise LogseqApiError("Current page has no recognizable page name.")
        page_id = _entity_id(current)

    current_blocks = call_api(args.base_url, args.token, "logseq.Editor.getPageBlocksTree", [page_name])
    if not isinstance(current_blocks, list):
        current_blocks = []

    linked_refs = call_api(args.base_url, args.token, "logseq.Editor.getPageLinkedReferences", [page_name])
    if not isinstance(linked_refs, list):
        linked_refs = []

    linked_items: List[Dict[str, Any]] = []
    for item in linked_refs:
        if not isinstance(item, dict):
            continue

        block = item.get("block")
        block_obj = block if isinstance(block, dict) else {}
        src_page_obj: Dict[str, Any] = {}

        candidate_page = item.get("page")
        if isinstance(candidate_page, dict):
            src_page_obj = candidate_page
        else:
            block_page = block_obj.get("page")
            if isinstance(block_page, dict):
                src_page_obj = block_page

        recency = _extract_recency_score(item)
        row: Dict[str, Any] = {
            "page": _page_name(src_page_obj),
            "page_id": _entity_id(src_page_obj),
            "block_id": _entity_id(block_obj),
            "recency_epoch": recency,
        }
        if args.output == "full":
            row["reference"] = item
        else:
            content = block_obj.get("content")
            if isinstance(content, str):
                row["excerpt"] = _truncate_text(content, args.excerpt_chars)
        linked_items.append(row)

    linked_items.sort(
        key=lambda x: (
            x.get("recency_epoch") is not None,
            int(x.get("recency_epoch") or -1),
        ),
        reverse=True,
    )
    linked_items = linked_items[: args.linked_limit]

    pages = call_api(args.base_url, args.token, "logseq.Editor.getAllPages", [])
    if not isinstance(pages, list):
        pages = []

    today = dt.date.today()
    journal_pages: List[Tuple[int, Optional[dt.date], Dict[str, Any], str]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        if not _is_journal(page):
            continue
        name = _page_name(page)
        if not name:
            continue
        jd = _journal_day(page)
        if jd is None:
            continue
        day = _journal_day_to_date(jd)
        if day is not None:
            age_days = (today - day).days
            if age_days > args.journal_days:
                continue
        journal_pages.append((jd, day, page, name))

    journal_pages.sort(key=lambda x: x[0], reverse=True)
    journal_pages = journal_pages[: args.journal_limit]

    recent_journals: List[Dict[str, Any]] = []
    for jd, day, page_obj, name in journal_pages:
        blocks = call_api(args.base_url, args.token, "logseq.Editor.getPageBlocksTree", [name])
        if not isinstance(blocks, list):
            blocks = []
        row: Dict[str, Any] = {
            "page": name,
            "page_id": _entity_id(page_obj),
            "journal_day": jd,
            "date": str(day) if day else None,
        }
        if args.output == "full":
            row["blocks"] = blocks
        else:
            row["blocks"] = _block_summaries(blocks, args.journal_block_limit, args.excerpt_chars)
        recent_journals.append(row)

    payload = {
        "strategy": "Read current page, then linked references (recent to old), then recent journals.",
        "page": {"name": page_name, "id": page_id},
        "current_page_blocks": (
            current_blocks
            if args.output == "full"
            else _block_summaries(current_blocks, args.current_block_limit, args.excerpt_chars)
        ),
        "linked_references_recent_to_old": linked_items,
        "recent_journals": recent_journals,
    }
    if args.compact_json:
        print(_compact(payload))
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def cmd_related(args: argparse.Namespace) -> int:
    page = args.page
    linked_refs = call_api(args.base_url, args.token, "logseq.Editor.getPageLinkedReferences", [page])
    blocks = call_api(args.base_url, args.token, "logseq.Editor.getPageBlocksTree", [page])

    namespace_pages: Any = None
    try:
        namespace_pages = call_api(
            args.base_url,
            args.token,
            "logseq.Editor.getPagesFromNamespace",
            [page],
        )
    except LogseqApiError:
        namespace_pages = None

    payload = {
        "page": page,
        "backlink_source_pages": sorted(backlink_pages(linked_refs)),
        "outgoing_links": sorted(outgoing_links_from_blocks(blocks if isinstance(blocks, list) else [])),
        "namespace_pages": namespace_pages,
        "raw_linked_references": linked_refs,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def _parse_day(value: str) -> int:
    parsed = dt.datetime.strptime(value, "%Y-%m-%d").date()
    return int(parsed.strftime("%Y%m%d"))


def cmd_journal(args: argparse.Namespace) -> int:
    target = _parse_day(args.date)
    pages = call_api(args.base_url, args.token, "logseq.Editor.getAllPages", [])
    if not isinstance(pages, list):
        raise LogseqApiError("Unexpected response from logseq.Editor.getAllPages")

    matched: List[Dict[str, Any]] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        if not _is_journal(page):
            continue
        if _journal_day(page) != target:
            continue

        name = _page_name(page)
        if not name:
            continue

        blocks = call_api(args.base_url, args.token, "logseq.Editor.getPageBlocksTree", [name])
        matched.append(
            {
                "page": name,
                "journal_day": target,
                "blocks": blocks,
            }
        )

    print(json.dumps({"date": args.date, "journal_day": target, "matches": matched}, indent=2, ensure_ascii=False))
    return 0


def cmd_topic(args: argparse.Namespace) -> int:
    name = args.name
    linked_refs = call_api(args.base_url, args.token, "logseq.Editor.getPageLinkedReferences", [name])

    tag_objects: Any = None
    try:
        tag_objects = call_api(args.base_url, args.token, "logseq.Editor.getTagObjects", [])
    except LogseqApiError:
        tag_objects = None

    payload = {
        "topic": name,
        "linked_references": linked_refs,
        "tag_objects": tag_objects,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def page_neighbors(base_url: str, token: str, page: str) -> Tuple[Set[str], Set[str]]:
    """Return (outgoing, backlink_pages)."""
    blocks = call_api(base_url, token, "logseq.Editor.getPageBlocksTree", [page])
    linked_refs = call_api(base_url, token, "logseq.Editor.getPageLinkedReferences", [page])

    outgoing = outgoing_links_from_blocks(blocks if isinstance(blocks, list) else [])
    backlinks = backlink_pages(linked_refs)
    outgoing.discard(page)
    backlinks.discard(page)
    return outgoing, backlinks


def cmd_traverse(args: argparse.Namespace) -> int:
    start = args.start_page
    max_depth = args.depth
    max_nodes = args.max_nodes

    queue: deque[Tuple[str, int]] = deque([(start, 0)])
    visited: Set[str] = set()
    edges: Set[Tuple[str, str, str]] = set()

    while queue and len(visited) < max_nodes:
        page, depth = queue.popleft()
        if page in visited:
            continue
        visited.add(page)

        if depth >= max_depth:
            continue

        outgoing, backlinks = page_neighbors(args.base_url, args.token, page)

        for nbr in sorted(outgoing):
            edges.add((page, nbr, "outgoing"))
            if nbr not in visited and len(visited) + len(queue) < max_nodes:
                queue.append((nbr, depth + 1))

        for nbr in sorted(backlinks):
            edges.add((nbr, page, "backlink"))
            if nbr not in visited and len(visited) + len(queue) < max_nodes:
                queue.append((nbr, depth + 1))

    output = {
        "start_page": start,
        "depth": max_depth,
        "max_nodes": max_nodes,
        "nodes": sorted(visited),
        "edges": [
            {"from": src, "to": dst, "relation": rel}
            for src, dst, rel in sorted(edges)
        ],
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Logseq local HTTP helper")
    parser.add_argument(
        "--base-url",
        default=os.getenv("LOGSEQ_BASE_URL", "http://127.0.0.1:12315"),
        help="Logseq HTTP base URL (default: LOGSEQ_BASE_URL or http://127.0.0.1:12315)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("LOGSEQ_TOKEN"),
        help="Logseq API token (default: LOGSEQ_TOKEN env)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    p_call = sub.add_parser("call", help="Run a raw API method call")
    p_call.add_argument("--method", required=True, help="Method name, e.g. logseq.Editor.getPage")
    p_call.add_argument("--args", help="JSON array for args, e.g. ['Page']")
    p_call.set_defaults(func=cmd_call)

    p_search = sub.add_parser("search", help="Search titles and block content")
    p_search.add_argument("--query", required=True)
    p_search.add_argument("--max-pages", type=int, default=500)
    p_search.add_argument(
        "--limit",
        "--max-results",
        dest="limit",
        type=int,
        default=20,
        help="Maximum number of matched pages to return",
    )
    p_search.add_argument("--offset", type=int, default=0, help="Skip this many matched pages")
    p_search.add_argument("--max-block-hits-per-page", type=int, default=3)
    p_search.add_argument(
        "--output",
        choices=("compact", "full", "names"),
        default="compact",
        help="compact: excerpted hits, full: full block content, names: page + ids + counts",
    )
    p_search.add_argument(
        "--format",
        choices=("json", "outline", "jsonl"),
        default="json",
        help="Output format: json for APIs, outline for terminal reading, jsonl for streaming tools",
    )
    p_search.add_argument("--excerpt-chars", type=int, default=120, help="Excerpt length for compact mode")
    p_search.add_argument("--compact-json", action="store_true", help="Print one-line JSON output")
    p_search.set_defaults(func=cmd_search)

    p_context = sub.add_parser(
        "context",
        help="Build graph-aware reading context from current page + linked refs + recent journals",
    )
    p_context.add_argument(
        "--page",
        help="Optional page name. If omitted, resolve from current Logseq page context.",
    )
    p_context.add_argument("--linked-limit", type=int, default=40)
    p_context.add_argument("--journal-limit", type=int, default=7)
    p_context.add_argument("--journal-days", type=int, default=30)
    p_context.add_argument("--current-block-limit", type=int, default=60)
    p_context.add_argument("--journal-block-limit", type=int, default=20)
    p_context.add_argument(
        "--output",
        choices=("compact", "full"),
        default="compact",
        help="compact: excerpts + ids, full: raw linked refs and raw blocks",
    )
    p_context.add_argument("--excerpt-chars", type=int, default=140)
    p_context.add_argument("--compact-json", action="store_true", help="Print one-line JSON output")
    p_context.set_defaults(func=cmd_context)

    p_related = sub.add_parser("related", help="Get backlinks/outgoing links for a page")
    p_related.add_argument("--page", required=True)
    p_related.set_defaults(func=cmd_related)

    p_journal = sub.add_parser("journal", help="Find journal note by YYYY-MM-DD")
    p_journal.add_argument("--date", required=True, help="Date in YYYY-MM-DD")
    p_journal.set_defaults(func=cmd_journal)

    p_topic = sub.add_parser("topic", help="Find notes linked to a topic/tag")
    p_topic.add_argument("--name", required=True, help="Topic/page/tag name")
    p_topic.set_defaults(func=cmd_topic)

    p_traverse = sub.add_parser("traverse", help="Traverse note graph via BFS")
    p_traverse.add_argument("--start-page", required=True)
    p_traverse.add_argument("--depth", type=int, default=2)
    p_traverse.add_argument("--max-nodes", type=int, default=120)
    p_traverse.set_defaults(func=cmd_traverse)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.token:
        print(
            "Missing API token. Set LOGSEQ_TOKEN or pass --token.",
            file=sys.stderr,
        )
        return 2

    try:
        return args.func(args)
    except (ValueError, LogseqApiError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
