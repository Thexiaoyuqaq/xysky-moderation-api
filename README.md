# XYSKY Moderation API

Standalone prohibited-word / content-moderation service for the XYSKY game
server. The game server ships no word list: it calls `POST /v1/moderate` for
every chat line (and any other text it wants checked) and applies the returned
`action`.

This rewrite keeps the wire response the game server already depends on, and
rebuilds everything else: normalization, matching, policy, dictionary format,
word list, validation and tests.

```bash
npm install
npm run validate        # offline dictionary check
npm test                # unit + API contract + corpus tests
npm start               # node src/app.js
npm run dev             # node --watch src/app.js
```

Default address: `http://0.0.0.0:8787`. Configure with `config/config.yml`.

## Quick text check

`tools/testText.js` is the fast way to inspect one line without starting a
server. It prints the action, masked text and every hit.

```bash
npm run check -- "加我微信一起跑图"
npm run check -- --scope nickname "昵称"
npm run check -- --file tools/samples.txt
npm run check -- --interactive
echo "不要赌博" | npm run check -- --stdin
npm run check -- --json "法轮"
```

Options: `--dictionary <dir>`, `--scope`, `--user`, `--state` (needs `--user`),
`--json`, `--verbose`, `--fail-on-block` (exit code 2), `--no-color`.
Cache and user state are off by default, so repeated lines are deterministic.
`tools/samples.txt` contains a small mixed corpus (benign, allowlisted and
actionable lines).

---

## Architecture

Six one-way layers. Detection never decides, policy never matches, and only the
response layer shapes the wire JSON.

```
HTTP          routes / auth / rate limit / zod schemas
  ↓
Text          sanitize → canonical → folded → compact (all views carry raw offsets)
  ↓
Detection     lexicon (Aho-Corasick) | regex rules | per-message heuristics | optional user state
  ↓
Suppression   span-level allowlist (only the overlapping hit is suppressed)
  ↓
Policy        negation context → action aggregation → escalation → scope profile
  ↓
Response      mask original text → existing JSON contract
```

| Path | Responsibility |
|---|---|
| `src/http/` | Express routes, bearer auth, rate limiting, request schemas, errors |
| `src/text/` | NFKC/traditional/homoglyph/leet folding, compact view with gap metadata |
| `src/match/` | Automaton, lexicon, regex rules, heuristics, allowlist, user state |
| `src/dictionary/` | Dictionary schemas, validation, compilation |
| `src/policy/` | Action vocabulary, negation context, verdict/overlap selection |
| `src/response/` | Wire response builder and masking |
| `src/engine.js` | Orchestrates the pipeline; the only entry point routes call |

There is no build step. CommonJS, Node >= 22, 2-space indentation.

---

## HTTP API

All responses are JSON. When `auth.token` is set, every endpoint except
`/health` requires `Authorization: Bearer <token>`.

### `GET /health`

```json
{
  "ok": true,
  "words": 452,
  "version": "2026-10-25",
  "uptimeMs": 1234,
  "cacheSize": 0,
  "patterns": 521,
  "rules": 23,
  "allowlist": 37,
  "stateUsers": 0
}
```

`words`, `version`, `uptimeMs` and `cacheSize` are the original fields; the rest
are additive diagnostics.

### `POST /v1/moderate`

```json
{
  "text": "加我V信 abc123",
  "scope": "chat",
  "userId": "optional",
  "locale": "optional",
  "context": { "levelId": 1 }
}
```

The response contract is unchanged:

```json
{
  "ok": true,
  "clean": false,
  "whitelisted": false,
  "action": "review",
  "shouldBlock": false,
  "shouldReview": true,
  "filteredText": "加我** abc123",
  "violations": [
    {
      "type": "word",
      "word": "V信",
      "original": "加微信",
      "category": "advertisement",
      "level": "medium",
      "action": "replace",
      "description": "引导私下联系",
      "position": { "start": 2, "end": 4 },
      "severity": 2,
      "source": "lexicon",
      "id": "advertisement.jiaweixin",
      "negated": false
    }
  ],
  "matchedCount": 1,
  "version": "2026-10-25",
  "cached": false,
  "hitCount": 3,
  "suppressedCount": 2,
  "escalated": false,
  "flags": []
}
```

Original fields keep their exact semantics:

| Field | Meaning |
|---|---|
| `action` | `allow` / `replace` / `review` / `block` |
| `clean` | no reported violations |
| `whitelisted` | every candidate hit was suppressed by the allowlist |
| `shouldBlock` | `action === "block"` |
| `shouldReview` | `action === "review"` |
| `filteredText` | original text with reported spans masked |
| `matchedCount` | number of reported (non-overlapping) violations |
| `version` | dictionary version |
| `cached` | served from the text cache |

Additive fields (`severity`, `source`, `id`, `negated`, `hitCount`,
`suppressedCount`, `escalated`, `flags`) are ignored by the current game server.

`action` semantics for the game server:

| action | Game server behavior |
|---|---|
| `allow` | send as-is |
| `replace` | send `filteredText` |
| `review` | send as-is and record the violation |
| `block` | reject the message |

`scope` is free-form (`chat`, `nickname`, `recording`, `club_name`, ...). Entries
may restrict themselves to scopes.

### `POST /v1/moderate/batch`

```json
{ "items": [ { "text": "..." }, { "text": "...", "scope": "nickname" } ] }
```

Returns `{ "results": [ ... ] }`. Maximum 50 items.

### `GET /v1/stats`

Read-only counters: request/action/category distribution, cache hits/misses,
average and max duration, dictionary sizes, state user count.

### `POST /v1/reload`

Atomically loads a new dictionary, swaps it in and clears the cache. The old
dictionary stays active if loading fails. With `auth.token` empty, reload is
only allowed from loopback.

---

## Matching model

Every view carries `[start, end)` offsets back into the original string, so
matches found after normalization can still be masked and reported correctly.

| View | Transformation | Used by |
|---|---|---|
| `raw` | original | structural rules, masking, reporting |
| `canonical` | NFKC, lowercase, traditional → simplified | contact/PII/URL/scam rules |
| `folded` | canonical + Cyrillic/Greek homoglyphs + leet | Latin words |
| `compact` | folded, letters/numbers only, with gap metadata | CJK words, spaced-Latin evasion |

### What is caught

- Full-width (`ｆｕｃｋ`), Traditional (`廢物`), zero-width (`傻​逼`),
  homoglyph (`аv` with Cyrillic `а`), and leet (`sh1t`) forms.
- CJK insertion: `傻 逼`, `傻😀逼`, `法\n轮` (gap bounded by
  `moderation.maxGap`, default 2 raw characters).
- Spaced Latin for words of 4+ letters: `f a l u n`, `f.a.l.u.n` (one separator
  per internal gap, no sentence terminator).
- Contact info and evasion: phone numbers (plain/spaced), ID cards, bank cards,
  QQ/WeChat IDs, email, URLs, short links, invisible-character runs, Zalgo.

### What is deliberately *not* caught

- A Latin word inside a longer word: `av` does not hit `have`, `nt` does not hit
  `content`, `asb` is not `sb`. Latin entries require ASCII word boundaries.
- A CJK match across a strong sentence terminator: `傻。逼` and `法！轮` are not
  treated as one word.
- A single CJK character is never accepted as an entry (validated at load time),
  so `鸡`/`约`/`冲`/`胸` no longer poison normal chat.

### Allowlist is span-local

An allow span only suppresses hits fully contained inside it. A message can be
partially allowed and partially blocked:

```text
垃圾桶法轮  →  垃圾 is allowed, 法轮 still blocks
```

This replaces the old behavior where one allow pattern anywhere disabled the
whole message.

### Negation context

Condemnation is not abuse. When a `replace`/`block` hit is preceded, in the same
clause, by a negation/condemnation marker (`不要`, `反对`, `抵制`, `禁止`,
`远离`, `举报`, `谨防`, `不`, ...), it is downgraded to `review`:

```text
不要赌博       → review (still logged)
举报外挂       → review
我不喜欢赌博   → review
```

Double negation (`我不反对...`) is not downgraded. A message such as
`我不管，我要赌博` is not downgraded because the comma starts a new clause.

### Escalation

When one message contains `escalation.sameCategory` hits in the same category
(default 3) or reaches `escalation.totalSeverity` (default 6), the action rises
one step. Identical spans count once, so one phone number matched by three rules
does not escalate. A broad heuristic covering several word hits does not erase
those hits either.

`neverBlock` categories (self-harm) cap their own contribution at `review`, even
after escalation.

### Scope profiles

`moderation.scopes.<scope>` can override policy. The default profile turns
`review` into `replace` for `nickname`, because the client shows the original
nickname and a review-only verdict would have no visible effect.

### Optional user state

It is enabled in the shipped config, but the core works without it. When a
request carries `userId`:

- duplicate messages within `state.duplicateWindowMs` (default 3×) → spam review
- more than `state.flood.max` messages per window → flood review
- repeated severe violations within `state.violationWindowMs` → escalation

Only a truncated SHA-256 hash, timestamps and counters are stored, never raw
text. State lives in-process (bounded LRU + TTL); multiple instances keep
independent state. Stateful requests bypass the shared text cache.

---

## Dictionary

The dictionary is a directory, not a single file:

```
data/dictionary/
  manifest.json      version / description / optional explicit file list
  categories.json    category defaults (level, severity, action, scopes, neverBlock, maxAction)
  words/<name>.json  one file per category
  rules.json         regex rules (contact info, scam patterns, structural evasion)
  allowlist.json     span-level allow patterns
```

Validate with:

```bash
npm run validate
```

The validator rejects schema errors, duplicate ids, unknown categories,
single-character CJK words, empty patterns and obvious catastrophic-backtracking
regexes. Warnings are printed for unknown scopes.

### Word entries

```json
{
  "category": "advertisement",
  "entries": [
    {
      "id": "advertisement.contact_channel",
      "word": "示例词",
      "aliases": [
        "示例变体",
        { "word": "abc", "severity": 1, "action": "review" }
      ],
      "match": "auto",
      "severity": 2,
      "action": "replace",
      "scopes": ["chat", "nickname"],
      "maxGap": 2,
      "description": "引导私下联系"
    }
  ]
}
```

- `id` is stable and globally unique; it is what logs, stats and allowlist
  references use.
- `match`: `auto` (default), `cjk` or `latin`. `auto` selects `latin` for pure
  ASCII word entries and `cjk` for anything containing Han characters.
- Aliases are full patterns, not word fragments. They inherit the entry's
  severity/action/scopes unless overridden.
- Entries inherit category defaults; per-entry fields win.
- `maxGap` only applies to CJK matching: how many raw characters may be skipped
  between two pattern characters.

### Categories (shipped defaults)

| Category | Default action | Severity | Notes |
|---|---|---|---|
| `profanity` | replace | 2 | insults and personal attacks |
| `sexual` | replace | 3 | explicit content; severe sexual violence overrides to block |
| `violence` | block | 4 | threats, extreme violence, weapons |
| `selfharm` | review | 4 | `neverBlock`, `maxAction: review` |
| `hate` | block | 4 | slurs and dehumanizing terms |
| `politics` | block | 4 | separatism and sensitive topics; circumvention is review |
| `gambling` | block | 4 | gambling sites and terminology |
| `fraud` | block | 4 | scams, RMT, account trading |
| `advertisement` | replace | 2 | ads, contact channels, invites |
| `spam` | review | 1 | flood/repetition terms and heuristic signals |
| `privacy` | replace | 3 | phones, ID/bank cards, QQ/WeChat, email, URLs |
| `cheating` | block | 4 | cheats, exploits, server attacks |
| `minor_safety` | block | 4 | child safety and grooming |
| `evasion` | review | 1 | invisible characters, Zalgo |

### Regex rules

```json
{
  "rules": [
    {
      "id": "privacy.phone",
      "category": "privacy",
      "pattern": "(?<![0-9])1[3-9][0-9]{9}(?![0-9])",
      "view": "canonical",
      "description": "手机号"
    }
  ]
}
```

`view` is one of `canonical` (default), `folded`, `compact`, `raw`. Rules run
with the `g` flag. Matches are mapped back to raw offsets. Keep patterns local
and reviewed: the validator only rejects obvious nested quantifiers.

### Allowlist

```json
{
  "allowlist": [
    { "id": "allow.example", "pattern": "正常短语", "description": "false positive guard" }
  ]
}
```

Use `regex` + `view` instead of `pattern` for regex-based allow spans. Allowlist
entries can also have `scopes`.

---

## Configuration

`config/config.yml` (defaults are defined in `src/config.js`):

```yaml
server:   { host: "0.0.0.0", port: 8787 }
auth:     { token: "" }                    # empty = open; bind to loopback then
dictionary:
  path: "./data/dictionary"
  version: ""                              # optional override
moderation:
  replacementChar: "*"
  maxTextLength: 2000
  defaultScope: "chat"
  maxGap: 2
  logViolations: true
  escalation: { enabled: true, sameCategory: 3, totalSeverity: 6 }
  scopes:
    nickname: { reviewAction: "replace" }
cache:    { enabled: true, maxEntries: 5000, ttlSeconds: 300 }
rateLimit:{ enabled: true, windowMs: 10000, max: 120, maxBuckets: 10000 }
state:
  enabled: true
  ttlSeconds: 600
  maxUsers: 20000
  duplicateWindowMs: 60000
  duplicateThreshold: 3
  violationWindowMs: 600000
  violationThreshold: 3
  flood: { windowMs: 10000, max: 8 }
heuristics: { enabled: true }
```

---

## Game server integration

The game server config and call path are unchanged:

```yaml
contentModeration:
  enabled: true
  apiUrl: "http://127.0.0.1:8787"
  apiToken: ""               # must equal auth.token above when set
  timeoutMs: 3000
  onError: "allow"           # allow = fail open, block = fail closed
  cacheTtlSeconds: 60
  logViolations: true
```

`src/helper/game/ContentModeration.js` only reads `action`, `violations`,
`filteredText` and `version`, all of which are unchanged. `ChatSend` maps the
action to the chat protocol as before.

Docker: `apiUrl` must not be `127.0.0.1` inside a container. Use the service name
on the same network (`http://moderation-api:8787`) or
`http://host.docker.internal:8787` for a host service.

---

## Security notes

- Set `auth.token` whenever the service is reachable from other machines.
- With no token, bind to `127.0.0.1`; `/v1/reload` is loopback-only in that mode.
- The dictionary and its regexes are trusted local input. Keep the directory
  writable only by the service account.
- Rate limiting is per IP; put the service behind the game server or a reverse
  proxy rather than exposing it publicly.
- State stores only truncated text hashes, timestamps and counters.

---

## Extending

- Add a word: create/edit `data/dictionary/words/<category>.json`, give it a
  globally unique id, run `npm run validate`, then `POST /v1/reload` (or
  restart).
- Add a category: add it to `categories.json` (and optionally a words file).
- Add a regex rule: `rules.json`; prefer `canonical` unless you specifically
  need raw text.
- Add a false-positive guard: `allowlist.json`; prefer the longest benign span.
- Add behavior: heuristics go in `src/match/heuristics.js`, history-based
  signals in `src/match/state.js`; both emit hits, never final verdicts.
- Add tests beside the relevant layer; the corpus test in
  `test/corpus.test.js` is the main regression net for false positives and
  evasions.
