---
name: senda-review
description: Review a change against this project's own conventions and domain invariants (language rules, client/server boundary, the /api/v1 mirror, plan/shopping invariants, design guidelines, web/mobile parity). Use after a non-trivial change to this repo, or when asked to "review against project conventions" / run the project review checklist. Complements /code-review (generic correctness bugs), it does not replace it.
---

# Senda review

Project-specific review pass. The generic `/code-review` skill hunts for correctness bugs;
this one checks the things that get corrected repeatedly **in this repo** — conventions,
deliberate design decisions, and domain invariants that a new change tends to break by
accident.

## Steps

1. Read [docs/agents/code-review.md](../../../docs/agents/code-review.md) — the checklist,
   kept current with what actually gets corrected.
2. Read `CONTEXT.md` and any relevant `docs/adr/` per
   [docs/agents/domain.md](../../../docs/agents/domain.md), so findings use the project's
   vocabulary and respect recorded decisions.
3. Get the diff under review: `git diff main...HEAD` for the branch, or the range the user
   named.
4. Walk the checklist against the diff. For each hit, report: the file and line, which
   checklist item it touches, and the concrete fix. Skip sections the diff doesn't touch —
   don't pad.
5. If the diff touches plan/shopping/date logic or a parser, confirm a test in
   `src/lib/*.test.ts` covers the change (see [docs/agents/testing.md](../../../docs/agents/testing.md)).
   Missing coverage on that code is itself a finding.
6. If nothing in the checklist is violated, say so plainly — one line per section checked.

## Keeping the checklist current

When the user corrects something during or after a review that isn't in
`docs/agents/code-review.md`, add it there in the same session. The list is only worth
consulting if it reflects today's standards.
