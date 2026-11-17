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
| `manifest.webmanifest` | Tells phones the app's name, icon and colours so it can be installed. |
| `sw.js` | Service worker: keeps a copy of the app so it opens fast and works offline. |
| `icons/` | App icons for home screens and browser tabs. |

## Data

Data is currently saved in the browser on each device (`localStorage`).
Use **Export Backup** / **Import Backup** to move it between devices.
Cloud sync across devices is the next planned step.

Backup files (`*backup*.json`) are deliberately excluded from git so personal
work data never ends up in the repository.
