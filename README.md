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
| `manifest.webmanifest` | Tells phones the app's name, icon and colours so it can be installed. |
| `sw.js` | Service worker: keeps a copy of the app so it opens fast and works offline. |
| `icons/` | App icons for home screens and browser tabs. |
| `.nojekyll` | Tells GitHub Pages to publish the files as-is. |

## PIN lock

Optional. Tap **Set PIN** (under End-of-Day Notes) to choose a 4–6 digit PIN.
The app then asks for it when it opens and after it has been in the background
for more than a minute. After 5 wrong tries there is a 30-second wait.

It is a privacy screen for your own device, not encryption: it stops someone who
picks up your unlocked phone or laptop. The PIN is stored only as a salted hash.
**Forgot PIN** erases this device's dashboard data, so keep a backup.

## Data

Data is currently saved in the browser on each device (`localStorage`).
Use **Export Backup** / **Import Backup** to move it between devices.
Cloud sync across devices is the next planned step.

Backup files (`*backup*.json`) are deliberately excluded from git so personal
work data never ends up in the repository.
