# token-coach

Reads your local **Claude Code** and **Codex** session logs and tells you where the tokens actually went — repeated file reads, one-off huge tool outputs, bloated `CLAUDE.md`/`AGENTS.md` files. Not another cost dashboard.

```
$ npx token-coach analyze

token-coach — 87 sessions analyzed

  claude-code — 66 sessions, ~169,036,530 fresh tokens (excludes cached/reused context — not a dollar figure)
  codex — 21 sessions, ~618,288,022 fresh tokens (excludes cached/reused context — not a dollar figure)

Top offenders (12 of 926):

⚠ Read re-read the same target 6x in a row (~19,100 tok)
  "/tmp/patches/staged-full.diff" — 6 consecutive reads with no edit to it in between.
  The first was necessary; the other 5 returned content already in context.

⚠ Read returned a 13,486-token result (~13,486 tok)
  "…/tool-results/toolu_019Rgx6jsxp1BsL8xNbLyTek.json" — one call. Worth checking whether the agent needed all of it.
```

Everything runs locally against files already on your disk. **No network calls, nothing uploaded, nothing leaves your machine.**

## Why this exists, and why it's *not* another usage dashboard

There are already several good tools for tracking Claude Code / Codex token cost and burn rate — [ccusage](https://ccusage.com) in particular already covers a dozen+ agent CLIs well, and Anthropic ships native usage analytics for Team/Enterprise accounts. Rebuilding that would be redundant.

What's missing is the layer *underneath* the dollar figure: **why** a session burned what it burned, in specific, actionable terms. Research on real agent sessions has found repeated re-reads of unchanged files account for a large share of avoidable spend (see [gotcontext.ai's write-up](https://gotcontext.ai/news/researcher-finds-42-of-coding-agent-tokens-are-wasted-on-repeated-file-reads): 42% of tokens across a Claude Code / Cursor / Codex sample). Someone's already built a linter for bloated `AGENTS.md` files in isolation. Nobody had tied "diagnose the waste" + "both major CLIs" together — this is that.

This started as a personal tool (see the [session log locations](#where-it-reads-from) below — it's literally pointed at my own `~/.claude` and `~/.codex`) and is open-sourced as-is for anyone who wants the same thing.

## Install

```
npx token-coach analyze
```

or install it globally:

```
npm install -g token-coach
token-coach analyze
```

## Usage

```
token-coach analyze [--tool claude|codex|all] [--limit N] [--since-days N]
```

- `--tool` — restrict to one tool (default: both)
- `--limit` — how many findings to print (default: 20)
- `--since-days` — only include sessions started in the last N days

## What it actually checks (v0.1)

1. **Repeated reads** — the same file/target read 3+ times *in a row*, with no edit to it in between, in a single session. A read right after an edit is excluded (that's the agent checking its own change, not waste); a target under 3 characters is excluded (almost always a filter fragment like `"."`, not a real identifier).
2. **Large one-off outputs** — a single tool call whose result crossed a size threshold (~2,500 tokens). This is a *size proxy*, not a verdict — a legitimately large file the agent needed in full isn't waste. It's a pointer for you to check, not an automated judgment.
3. **Bloated rules files** — `CLAUDE.md` / `AGENTS.md` over ~250 lines, or with a high ratio of near-duplicate lines. These get loaded into *every* session in that project, so bloat here is a recurring tax, not a one-off.

Every "estimated tokens" number is a **character-count approximation** (~4 chars/token), not a real tokenizer count. Good enough to rank offenders, not good enough to bill anyone.

### What it deliberately does *not* claim

- It does not compute a dollar cost.
- Claude Code's "fresh tokens" total and Codex's are computed by genuinely different methods (see `src/adapters/*.ts` for why) — each is internally consistent, neither is a precise apples-to-apples comparison against the other.
- "Repeated reads" can't know if a file changed *outside* the tool (e.g. another process, another terminal) — it only knows about edits the same session made.
- No live/real-time coaching yet (v0.1 is post-hoc analysis only). Both CLIs now have a real hooks system (Claude Code's `PreToolUse`/`PostToolUse`/`Stop`; Codex's stable-as-of-0.124 lifecycle hooks) that could drive this live later — see [Roadmap](#roadmap).

## Where it reads from

| Tool | Path |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` |

Both formats are undocumented/informal and confirmed against real transcripts on one machine, not an official spec — they can and do change between CLI versions. Adapters are isolated in `src/adapters/` specifically so a format change is a one-file fix, not a rewrite. If `token-coach` comes back empty or errors on your logs, that's the most likely reason — please open an issue with your CLI version.

## Roadmap

- [ ] Live coaching via Claude Code / Codex hooks (nudge during the session, not just after)
- [ ] A third adapter, contributions welcome (the `Session`/`ToolCallEvent` shape in `src/types.ts` is the whole contract — see `src/adapters/codex.ts` for the smallest complete example)
- [ ] Smarter "was this output actually reused" detection (today's `large-output` check is size-only)

## Contributing

Adapters and heuristics are both small, isolated modules — see `src/adapters/*.ts` and `src/analyze/*.ts`. PRs welcome, especially:
- Adapters for other CLIs (Cursor, Windsurf, Amp, ...)
- Heuristics with a clear, testable definition of "waste" (vague "this seems long" checks won't be merged — see `src/analyze/repeatedTargets.ts` for the bar: a specific, falsifiable rule with tests for both the true positive and the near-miss it must *not* flag)

```
npm install
npm run typecheck
npm test
npm run dev -- analyze   # run against your own local logs
```

## License

MIT — see [LICENSE](./LICENSE).
