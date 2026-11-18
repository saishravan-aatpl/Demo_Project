# Workstack — notes for Claude

Workstack is a personal daily work tracker for one person (and, optionally,
colleagues using their own accounts). It tracks projects, tasks, people,
"pinned for today" focus items, end-of-day notes and the time left until
leaving work. Detailed work lives in JIRA; this is a light, fast overview.

## Working with the owner

- The owner has **no coding experience**. Explain things simply, like a senior
  mentor, and avoid jargon (or explain it in one line).
- **Design changes: show mockups first and wait for confirmation** before
  writing any code. Offer a few options when the direction isn't clear.
- **Claude does the merging.** After all tests pass, commit on the work branch,
  fast-forward `main` (`git push origin HEAD:main`), then confirm the GitHub
  Pages deploy succeeded. The owner does not want to merge themselves.
- Bump `CACHE_VERSION` in `sw.js` on every release so phones pick up the update.
- Decided against, so don't propose again: due dates, search, a star icon for
  focus (pins are used instead), red colours on the time pill, pinch-zoom.

## Privacy rules (the repo is PUBLIC)

- Never commit the owner's data: backups (`*backup*.json` is git-ignored),
  colleague or customer names, their email, or their company email domain.
  Test data must be made up.
- `supabase/company-only-signups.sql` keeps the placeholder `yourcompany.com`.
- `config.js` holds only the Supabase URL and **publishable** key (safe to be
  public). Never use or ask for the secret / service_role key.

## How it's built

Plain HTML/CSS/JS, no build step, no framework. Hosted on GitHub Pages from
`main`. Installable as a PWA ("Share → Add to Home Screen").

| File | What it does |
|------|--------------|
| `index.html` | All markup: top bar, left rail, main column, people, notes, phone tab bar, dialogs (sheets) |
| `app.js` | Main logic: state, rendering, pins, quick add, @-mentions, undo, leaving-time pill, menus |
| `styles.css` | All styles. Later sections override earlier ones ("Layout v2", "Plan today", "Round 2") |
| `sync.js` | Supabase sign-in gate, offline mode, cloud save/load, realtime, sign-out |
| `merge.js` | Three-way merge of two devices' changes (tested by `tests/merge.test.js`) |
| `lock.js` | Optional PIN lock (lasts until today's leaving time; 10 min idle after hours) |
| `drag.js` | Pointer-event drag-to-reorder for tasks and projects (touch: press and hold) |
| `menu.js` | The small ⋯ pop-up menus, with submenus |
| `sw.js` | Service worker: offline cache, network-first |
| `config.js` | Supabase URL + publishable key |
| `supabase/*.sql` | Database setup (one row per user, row-level security) and company-only sign-ups |
| `.github/workflows/keep-supabase-awake.yml` | Pings Supabase every 3 days so the free project doesn't pause |

Key details:
- Data is stored in `localStorage` (`officeDailyDashboard.*` keys) and synced to
  the Supabase table `public.dashboards` with a `version` column for conflict checks.
- Synced fields: projects, people, usualLeaveTime, leaveTime, leaveDate, dayNotes.
  Task fields: text, done, person, pinnedOn. Add new task fields to `TASK_FIELDS`
  in `merge.js` or they won't sync.
- Dates are local `YYYY-MM-DD` (`toLocaleDateString('en-CA')`).
- Screen sizes: phone < 700px (chips, bottom tabs, + button), tablet 700–1099,
  laptop ≥ 1100 (left rail + main + notes).
- iPhone: inputs need font-size ≥ 16px or iOS zooms in; zoom is disabled on purpose.
- Time pill: grey normally, black in the last hour and once past leaving time. Never red.
- Top bar, left list and notes column must stay put while scrolling. Never put
  `overflow-x: hidden` on `html`/`body` (it breaks that); use `clip`.
- Keyboard: arrow keys work in option groups (`data-arrows`), ⋯ menus, the
  person picker and @-suggestions. Keep that working for new lists: the
  selected option must be clearly visible (dark fill #111827, white text),
  Enter picks it, Esc closes and returns focus to where you were.
- Esc must close every pop-up wherever the cursor is inside it. app.js closes
  the top open `<dialog>` itself on Esc (don't rely on the browser), closes an
  open name picker, and leaves the notes box. New pop-ups need the same.
  The owner uses **Brave**, which sometimes doesn't pass the Esc *press* to the
  page: app.js replays an Esc *release* as a press when that happens.
- Menu behind your initial (`#menuDialog`): account + sync tag, Usual leaving
  time, Lock now (if PIN), "Settings & backup ›", Sign out. Rarely used items
  (PIN, export/import, change password) live in `#settingsDialog`. Row icons
  come from `data-icon` on `.menu-row` (CSS masks), so JS can set textContent.
- Arrow-key selection style everywhere: rounded dark fill + white text (no
  square outlines). An already-chosen dark item gets a ring when focused.
- Focus outlines / dark keyboard highlights only show while `html.using-keys`
  is set (Tab or arrow keys; cleared by any tap/click). Never show them on phones.
- Pop-ups opened with the mouse focus the box itself, not its first button
  (a stray Enter must not press anything); ↓ then highlights the first row.
- Troubleshooting: add `#debug` to the address to show errors and Esc/Enter
  key events in a box (inline script in `index.html`); bump
  `WORKSTACK_BUILD` at the top of `app.js` with each release.
- Samsung keyboards show "Send"/"Go" instead of Enter: put single text boxes in
  a `<form>` and handle `submit`, or offer a tappable button.

## Testing

**Before every release run both, and only merge when everything passes:**

- `node tests/merge.test.js` — merge logic.
- `bash tests/run-ui.sh` — all screen checks (Playwright + Chromium, which is
  pre-installed in cloud sessions). It starts `python3 -m http.server 8123`
  from the repo if needed, and a pretend cloud (`tests/helpers/fake-cloud.js`,
  port 8124) for the sign-in/sync checks. Run a few with
  `bash tests/run-ui.sh esc keyboard`. Takes a few minutes.

Layout: `tests/ui/*.js` (one file per area; each prints PASS/FAIL lines),
`tests/fixtures/sample-data.json` (8 projects, 12 people, same shape as a real
backup) and `small-data.json`, `tests/helpers/mock-supabase.js` (stands in for
supabase-js). All names in them are made up — keep it that way, never real
backups. When a fix or feature changes behaviour, update or add a check here.
