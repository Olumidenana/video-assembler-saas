# Brief for Antigravity: research what makes short videos trend, then make the editor live up to it

You are working on **Anti-Timeout**, a Next.js 16 web app (installable PWA) that turns long videos into
viral short clips and edits. Video work happens in the browser with FFmpeg.wasm (nothing is uploaded);
Supabase handles auth and data, Paystack takes payments in naira, hosting is Vercel Pro.

The owner wants three things from you, in this order:

1. **Research** (with your browser): watch what actually trends on YouTube Shorts (and TikTok/Reels
   where visible) and why, and turn it into a structured knowledge base the app uses.
2. **Fix the editor's navigation**: picking a tool in the sidebar must show only that tool.
3. **Direct sharing** to YouTube, TikTok and WhatsApp, done for real, plus wiring the research into the
   edit engine so edits get noticeably better.

Then push to a branch and stop. The work will be reviewed in Claude Code before it goes live.

---

## 0. Ground rules (read first)

- **Branch**: create `antigravity/research-ux-sharing` from `claude/awesome-faraday-39b0kr` and push only
  there. Do not push to `claude/awesome-faraday-39b0kr` (it deploys to production) or `main`. Do not
  open a PR or merge.
- Read `AGENTS.md` and `README.md` first. This is **Next.js 16**: APIs differ from older versions; check
  `node_modules/next/dist/docs/` before using a Next API you're unsure of. `proxy.ts` replaces
  middleware; route files export only handlers; `PageProps<"/route">` types pages.
- **Never** paste or commit secrets. New server keys go in `.env.example` (empty) and are documented;
  the owner adds the values in Vercel as type Secret.
- **Do not run Prettier on `src/app/editor/editor.tsx`** (the repo doesn't use it; it produced a
  1,300-line diff once). Match the surrounding style by hand.
- `/editor` is **cross-origin isolated** (COOP/COEP, see `next.config.ts`). Third-party scripts,
  iframes and images there must send CORP/CORS headers or be self-hosted, or they're blocked. Navigation
  between `/editor` and other pages uses full page loads (`src/components/hard-link.tsx`).
- FFmpeg.wasm (5.1, multi-threaded core) has a **fixed thread pool**: keep graphs with more than three
  inputs single-threaded for filters (already done in `buildReencodeArgs`), don't add slice-threaded
  filters (fade, xfade) to big graphs, and don't run more than two inputs in `extractFrames`. An invalid
  option value can hang wasm rather than error.
- Before every push: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (180+ tests, all must pass),
  `npm run build`. Then open the editor in the browser and actually use what you changed.
- Copyright: **do not download or store anyone's videos**. Watch, take notes, record URLs.

---

## 1. Research: what makes a short trend (the core of this app)

The app's edge is content psychology: picking the moments, hooks, structure and music that keep people
watching, rewatching, commenting and sharing. Today those rules come from articles. Replace them with
evidence from real top-performing videos.

### What to watch

Use YouTube search (Shorts filter, sort by view count, last 12 months) and trending/explore pages. If the
owner is signed in to their YouTube account in the browser, also look at their channel's analytics
(Studio → Analytics → Content: retention curves, "swiped away" rate, top Shorts) and note what
separates their best performers from their worst.

Cover these niches, **at least 12 high-performing Shorts each** (100k+ views, ideally 1M+), plus 3 that
flopped from the same creators where you can find them, for contrast:

| Niche | Example searches |
|---|---|
| Anime edits | "anime edit", "phonk anime edit", "black clover edit", "jjk edit", "AMV" |
| Anime versus / comparisons | "goku vs", "who would win anime edit", "anime parallels" |
| Movie / series edits and trailer-style recaps | "movie edit", "trailer edit", "series recap shorts" |
| Podcast & interview clips | "podcast clip", "diary of a ceo shorts", Nigerian podcasts (e.g. "honest bunch", "the 90s baby show") |
| Streams & gaming | "kai cenat", "ishowspeed", "clutch", "funny gaming moments" |
| Sports | "football edit", "skills", "goal compilation shorts" |
| Comedy & skits (incl. Nigerian skits) | "nigerian skit", "comedy shorts" |
| Motivation & sermons | "motivational speech shorts", "sermon clip" |
| Music & dance | "afrobeats dance trend", "amapiano" |

### What to record for every video

Watch each one at least twice (once normally, once frame by frame around the opening and the cuts).
Record:

- URL, title, channel, views, likes, comments, upload date, length in seconds.
- **Hook (0–3 s)**: exactly what is seen and heard; any on-screen text (verbatim); which technique
  (curiosity gap, stakes, pattern interrupt, POV, bold claim, question, cold open / flash-forward,
  "wait for it"); where the face/subject is.
- **Structure**: timestamps of each section (cold open, setup, build, pause/silence, drop/climax,
  ending), the number of cuts and the cut rate per section (cuts per second), any speed ramps or slow
  motion and where.
- **Beat sync**: music genre, approximate BPM (tap along), whether cuts land on beats, whether the
  biggest visual hit lands on the drop, any silence before the drop and how long.
- **Effects**: flashes, zoom punches, shake, letterbox, colour grade, text cards (style, position,
  wording), captions (style: word-by-word, karaoke, boxed), emojis.
- **Ending**: loop (does the end flow into the start?), stinger, call to action (verbatim), end card or
  none.
- **Why it works**: one or two sentences in plain words. Be specific ("the punchline lands at 0:24, after
  a 0.5 s pause; the caption asks people to tag a friend"), not generic.
- For podcast clips: the opening line verbatim, whether it starts mid-sentence, clip length, whether it
  ends on a punchline or a question.

### What to produce

1. `docs/research/shorts-notes.md`: every video's notes, grouped by niche, with sources. This is the
   evidence.
2. `src/lib/assistant/knowledge/*.json`: the rules the app uses, derived from the notes. Every rule
   carries its evidence (`sources`: list of URLs, and `n`: how many of the watched videos showed it).
   Suggested files (adjust if the evidence says otherwise):
   - `formats.json`: edit structures per niche: sections with lengths in beats or seconds, cut rate per
     section, where the biggest moment goes, slow motion, pause before the drop, ending type, typical
     total length. (The app's current structures are in `src/lib/assistant/beat-edit.ts` `TEMPLATES` and
     `src/lib/assistant/talk-edit.ts`. Confirm, correct or replace them.)
   - `hooks.json`: hook lines and on-screen text that worked, per technique and niche, **rewritten as
     reusable templates** (no copying a creator's exact caption verbatim as a template unless it's a
     generic phrase like "Wait for it"). Max 6 words each. Plus trailer title-card triads.
   - `niches.json`: per niche: what moments to pick (signals: loud, fast, quiet, laughter, speech
     patterns), ideal length, music genre and BPM range, caption style, CTA, cold open yes/no.
   - `music.json`: genre → BPM range, where the drop goes, how long the pre-drop silence is.
   - `ctas.json`: closing calls to action that drove comments/shares, per niche.
3. A short `docs/research/summary.md`: the ten findings that matter most, each with its evidence count,
   and what you changed in the app because of it.

Add a schema test (`src/lib/assistant/knowledge/knowledge.test.ts`) that loads every JSON file and checks
its shape (required fields, number ranges, every rule has ≥1 source).

---

## 2. Use the research in the edit engine

Where the app makes these decisions today:

- Audience playbooks (Clip Pack): `src/lib/assistant/playbooks.ts`
- Hook library and picking: `src/lib/assistant/hooks.ts`
- Beat-synced edits (hype, versus, emotional, trailer): `src/lib/assistant/beat-edit.ts`
- Talking edits (quote edit, Top 3 countdown): `src/lib/assistant/talk-edit.ts`
- Moment finding and scoring: `src/lib/video/highlights.ts` (`findMoments`, `outputPeak`), `src/lib/assistant/viral.ts`
- Composed music (styles, BPM, drop, pause): `src/lib/audio/music.ts`
- AI prompts sent to Claude (keep the model and structure; enrich the guidance with the findings):
  `VIRAL_SYSTEM`, `VISION_SYSTEM`, `THEME_SYSTEM` in `src/lib/assistant/claude.ts`

Make these read from the knowledge JSON instead of hard-coded constants (import the JSON; keep it
statically typed). Then improve the edits where the research says the app is wrong or missing something.
Likely candidates, but follow the evidence:

- Cut rates, section lengths and total lengths per niche.
- Which moments open the edit (cold open choice) and which land on the drop.
- Hook text and trailer title cards per niche.
- Music genre and BPM per niche; length of the silence before the drop.
- Endings: loops vs stingers vs CTAs per niche.

Keep all existing tests passing; update test expectations only where the new evidence-based rules
deliberately change behaviour, and say so in the commit message.

---

## 3. Editor navigation: one tool at a time

**Problem**: the editor is one long page. Clicking a sidebar item (desktop) or chip (phone) in
`src/app/editor/workspace-nav.tsx` only scrolls to that section; every other tool stays on screen, which
is confusing.

**Wanted**: selecting a tool shows **only that tool's panel**, like tabs. Panels and their ids:

| Nav id | Panel (file) |
|---|---|
| `tool-start` | Add videos / start (`editor.tsx`, `start-panel.tsx`) |
| `tool-pack` | Clip Pack (`clip-pack.tsx`) |
| `tool-mashup` | Edits & mashups (`mashup-panel.tsx`) |
| `tool-viral` | Viral clips (`viral-panel.tsx`) |
| `tool-edit` | Auto-edit (`auto-edit-panel.tsx`) |
| `tool-timeline` | Timeline + player + segment list (`editor.tsx`, `player.tsx`, `segment-list.tsx`) |
| `tool-captions`, `tool-music`, `tool-brand` | Parts of export settings (`export-settings.tsx`) |
| `export` | Export section and finished outputs (`editor.tsx`) |

Requirements:

- One active tool at a time. Hidden panels keep their state: don't unmount them (use `hidden`/CSS, or
  lift state). All state already lives in `editor.tsx`'s `Editor` component, so prefer hiding over
  unmounting.
- The active tool is in the URL hash (`/editor#tool-pack`) so reloads, the back button and the PWA
  shortcuts in `src/app/manifest.ts` open the right tool. Default: `tool-start` with no videos,
  `tool-pack` once videos are added.
- Captions, Music and Format & logo can be one "Export" tab with sub-sections, or separate tabs; choose
  what's clearer. The Export button and the finished outputs must always be reachable (for example a
  sticky "Export" bar at the bottom on phones), and when any export finishes, switch to the Export tab
  so the result is visible (today it scrolls to `[data-testid=outputs]`).
- The task progress banner (`task-banner.tsx`) stays visible across tabs.
- Remove the scroll-spy in `workspace-nav.tsx`; keep the plan notes, locks and upgrade card.
- Works at 390 px wide (no sideways scroll) and on desktop. The phone chip bar stays sticky.
- Keep these `data-testid`s working: `clip-pack`, `mashup`, `mashup-card`, `viral-panel`, `auto-edit`,
  `segment-list`, `export-settings`, `outputs`, `output-previews`, `post-planner`, `file-input`,
  `engine-status`.

---

## 4. Direct sharing: YouTube, TikTok, WhatsApp

What exists (`src/app/editor/share-button.tsx`, `post-tools.tsx`, `src/lib/social/*`):

- **Share** button on each finished video: on phones it opens the system share sheet with the MP4
  (WhatsApp, TikTok and Instagram appear there) and copies the caption. On desktop it shows links to
  upload pages.
- **YouTube (Studio)**: connect channel (OAuth popup), post now or schedule. It is **fully built but
  hidden** until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set and migration
  `supabase/migrations/0004_social.sql` has run. The owner hasn't done that setup, which is why it seems
  missing.

What to build:

1. **One clear "Post" panel per finished video** with a big button per destination: YouTube Shorts,
   TikTok, WhatsApp (Status and chats), Instagram Reels, and "More…" (system share). Each shows its
   state honestly: ready, needs connecting, or "set up by the site owner" (with the reason in a
   tooltip, not an error).
2. **WhatsApp**: on phones, share the MP4 file via the Web Share API (`navigator.share({ files })`):
   WhatsApp then offers Status or chats. Where file sharing isn't supported (most desktops), download
   the file and open `https://wa.me/?text=<caption>` (WhatsApp Web) with clear "attach the downloaded
   video" guidance. Do not claim it posted to Status automatically: WhatsApp has no web API for that.
3. **TikTok**: implement the official **Content Posting API** (developers.tiktok.com):
   - Server routes like the YouTube ones: `/api/tiktok/connect` (OAuth v2 with PKCE, scopes
     `user.info.basic,video.upload`, plus `video.publish` for direct posting), `/api/tiktok/callback`,
     `/api/tiktok/status`, `/api/tiktok/token`, `/api/tiktok/disconnect`; store the refresh token in
     `social_connections` (add `'tiktok'` to the provider check in a new migration `0005`).
   - Upload from the **browser** straight to TikTok's upload URL (FILE_UPLOAD source, chunked), so the
     video still never touches our server. Use "upload to inbox" (`/v2/post/publish/inbox/video/init/`:
     the creator finishes the post in the TikTok app) by default; direct post
     (`/v2/post/publish/video/init/`) only when `TIKTOK_DIRECT_POST=1`, since that needs TikTok's audit
     and posts `SELF_ONLY` until approved.
   - Check CORS for the browser upload from the cross-origin-isolated `/editor`. If TikTok's upload host
     doesn't allow it, use a short-lived server relay that streams the bytes through without storing
     them, and document the tradeoff.
   - Env: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (Secrets), documented in `.env.example` and
     README with the exact app setup steps (redirect URI `<site>/api/tiktok/callback`, products: Login
     Kit + Content Posting API, sandbox test users).
   - Plan gating like YouTube: `PLAN_LIMITS.directPost` (Studio) in `src/lib/plans.ts`. Free and Pro
     still have the share sheet.
4. **YouTube**: keep the existing flow; surface it in the new Post panel; add a one-screen setup guide
   for the owner in README (already partly there under "Posting").
5. **Instagram**: share sheet on phones and a clear guide. The Instagram Graph API needs a Business
   account and Meta app review, and it pulls the video from a public URL (which would break "nothing is
   uploaded"), so don't build it now; write up what it would take in `docs/research/summary.md`.
6. Tests: route tests like `src/lib/social/youtube-routes.test.ts` for TikTok (mock fetch), unit tests for
   the upload chunking, and a browser check that every button renders its right state with no keys set.

---

## 5. When you're done

- Push `antigravity/research-ux-sharing`. In the final commit message (or `docs/research/summary.md`),
  list:
  - every file changed
  - what the research changed in the app
  - anything not finished and why
  - the env vars and SQL migrations the owner must add
- Do not deploy or change Vercel settings. The owner will bring the branch back to Claude Code for
  review, testing and release.
