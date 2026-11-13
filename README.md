# Tee Alert: Mangrove Bay

A small iOS test app (Expo / React Native) that watches Mangrove Bay's public tee sheet and sends a
notification when a time opens up in your window.

## How it works

- Mangrove Bay (City of St. Pete) books through **foreUP**: course `19671`, tee sheet `2149`, public
  booking class `12239`, with an 8-day booking window and 2 players minimum online. The app reads the same
  public JSON the booking page uses (`/index.php/api/booking/times`). No login is needed.
- You pick days, a time window, and a party size. Each check pulls the watched days, keeps the slots that
  match, and compares them with the previous check. Any matching slot that wasn't open last time, such as a
  cancellation, triggers a local notification. Tapping it opens the foreUP booking page.
- The first check, and any change to your criteria, only sets a baseline, so you don't get a burst of
  alerts for times that were already open.

## Run it on your iPhone (from Windows)

1. Install **Expo Go** from the App Store.
2. `npm install`, then `npx expo start`. Add `--tunnel` if the phone and PC aren't on the same Wi-Fi.
3. Scan the QR code with the iPhone Camera.
4. Tap **Notify me when a time opens**, allow notifications, then use **Send a test notification** to
   confirm alerts work.

`npm run web` shows the UI with sample data, because foreUP blocks browser (CORS) requests.

## Cloud poller (reliable alerts with the phone locked)

`poller/check.ts` runs the same foreUP client and matching code (`src/foreup.ts`, `src/match.ts`) on a GitHub
Actions schedule every 5 minutes (`.github/workflows/tee-watch.yml`). It pushes new openings to your phone
through [ntfy](https://ntfy.sh), a free push app, so it doesn't depend on iOS background refresh. The "already
open" list carries between runs in the Actions cache.

Setup:

1. Install **ntfy** from the App Store. Subscribe to a long random topic name, for example
   `mangrove-` followed by 16 random characters. Anyone who knows the name can read it, so don't make it
   guessable.
2. Push this folder to a **public** GitHub repo. Scheduled Actions are free and unlimited on public repos.
   Every 5 minutes is about 8,600 runs a month, which would use up a private repo's free minutes. No secrets
   live in the code.
3. In the repo, go to Settings → Secrets → Actions and add `NTFY_TOPIC` set to your topic name.
4. Edit `poller/watch.json` to set the days (`["Sat","Sun"]` or `"all"`), the window (`"07:00"`–`"11:00"`) and
   players. Changing it resets the baseline.
5. In the Actions tab, run **Tee time watch** once by hand. The first run only records a baseline.

Local dry run (prints instead of pushing): `node poller/check.ts`

Notes: GitHub can start scheduled runs a few minutes late, and turns off schedules after 60 days without
commits. Re-enable it from the Actions tab. Failed checks log a warning instead of failing the run, so you
don't get an email every 5 minutes when foreUP has a hiccup.

## Limits (it's a test app)

- **App open:** checks every 60 s.
- **Expo Go:** background checks aren't available at all (they need a development build). The app checks
  only while it's open; the cloud poller covers the rest.
- **App in background (dev build):** iOS runs `expo-background-task` when it decides to, at most every ~15 min and often
  less. Popular slots can get booked before that. That's why the cloud poller above exists.
- It uses an undocumented foreUP endpoint. If the course changes its booking setup, update the IDs in
  `src/foreup.ts`.

## Files

- `src/foreup.ts`: foreUP client plus mock data for web
- `src/match.ts`: pure matching/diff logic shared with the poller
- `src/watcher.ts`: app watch settings, storage, local notifications
- `poller/check.ts`, `poller/watch.json`: cloud poller and its settings
- `.github/workflows/tee-watch.yml`: 5-minute schedule
- `src/backgroundTask.ts`: iOS background refresh registration
- `App.tsx`: UI
