# Office Daily Dashboard

A simple daily work tracker: projects, tasks, who owns each task, a leaving-time
countdown, end-of-day notes, and a one-click summary to paste into chat or email.

It runs as a website on a laptop and can be installed on iPhone/Android as an app
("Add to Home Screen").

## What each file does

| File | Purpose |
|---|---|
| `index.html` | The page structure: what's on screen. |
| `styles.css` | How it looks: colours, spacing, phone layout. |
| `app.js` | How it behaves: adding tasks, saving, summary, import/export. |
| `lock.js` | Optional PIN lock screen for this device. |
| `drag.js` | Smooth drag-to-reorder for tasks and projects (mouse and touch). |
| `menu.js` | The small pop-up menus behind the ⋯ buttons. |
| `sync.js` | Cloud sync: sign-in (email + password), saving, live updates, offline catch-up. |
| `merge.js` | Combines changes made on two devices at the same time. |
| `config.js` | The two Supabase values sync needs (both safe to publish). |
| `vendor/` | Supabase's official browser library (v2.117.3), kept in the repo so the app doesn't depend on another website. |
| `supabase/setup.sql` | Creates the database table and its security rules. Run once in Supabase's SQL Editor. |
| `.github/workflows/keep-supabase-awake.yml` | Runs every 3 days on GitHub so the free Supabase project never pauses. |
| `tests/merge.test.js` | Automatic checks for the merge logic (`node tests/merge.test.js`). |
| `manifest.webmanifest` | Tells phones the app's name, icon and colours so it can be installed. |
| `sw.js` | Service worker: keeps a copy of the app so it opens fast and works offline. |
| `icons/` | App icons for home screens and browser tabs. |
| `.nojekyll` | Tells GitHub Pages to publish the files as-is. |

## Using it

- **Edit a task:** tap or click its name; Enter saves, Escape cancels.
- **Move a task:** on a phone, press and hold it, then drag (into any project, even a
  collapsed one). With a mouse, just drag it. Or use **⋯ → Move to project / Move to top**.
- **Move a project:** drag it by **☰**.
- **Collapse or delete a project / delete a task:** the **⋯** button.
- **Undo:** deleting, moving or importing shows an **Undo** button for a few seconds
  (up to 20 steps back; Ctrl/Cmd+Z on a laptop).

## PIN lock

Optional. Tap **Set PIN** (under End-of-Day Notes) to choose a 4–6 digit PIN.

How long an unlock lasts:

- **During work hours** (before your *Leaving for the day* time): stays unlocked until
  that time, even if you close and reopen the app. Changing the leaving time moves it.
- **At the leaving time** it locks by itself.
- **After work hours**: locks after 10 minutes without use (any tap or scroll resets it).
- **Next day** the PIN is needed again. **Lock now** locks immediately.

After 5 wrong tries there is a 30-second wait.

It is a privacy screen for your own device, not encryption: it stops someone who
picks up your unlocked phone or laptop. The PIN is stored only as a salted hash.
**Forgot PIN** erases this device's dashboard data, so keep a backup.

## Data and sync

Data is always saved in the browser on each device (`localStorage`), so the app
works offline. With **Cloud Sync** signed in, it is also stored in Supabase and kept
the same on every device:

- Sign in with email + password (create the account once, then sign in on each device).
- Changes upload about a second after you make them; other open devices update live.
- Offline changes upload when you're back online. If two devices changed things at
  the same time, both sets of changes are combined (`merge.js`).
- The database only lets each signed-in user read or change their own row
  (Row Level Security), which is why the key in `config.js` can be public.

**Export Backup** / **Import Backup** still work, and are a good habit regardless.

Backup files (`*backup*.json`) are deliberately excluded from git so personal
work data never ends up in the repository.
