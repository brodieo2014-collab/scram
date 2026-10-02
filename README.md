# Orbit Browser

A standalone browser-in-a-browser with tabs, an address/search bar, back/forward, reload, and a private Wisp relay. Website requests go through the relay; this is not a plain iframe wrapper. Scramjet rewrites pages inside the browser.

## Put it on Render — Free Web Service

1. Extract `orbit-browser.zip` on your computer.
2. On GitHub, create a new repository called `orbit-browser`. Upload the **contents** of the extracted folder. `package.json`, `package-lock.json`, `server.mjs`, and the `public` folder should be at the repository's top level. Do not upload the ZIP itself or `node_modules`.
3. On the Render screen, choose **Git Provider → GitHub**, connect your account, and select that repository.
4. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Service type | **Web Service** |
   | Runtime / language | **Node** |
   | Root Directory | Leave blank if `package.json` is at the repo root |
   | Build Command | `npm ci --ignore-scripts` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |
   | Health Check Path | `/healthz` |

5. Under **Environment Variables**, add `ACCESS_PASSWORD` with a password of at least 12 characters. This is your Orbit password, not your GitHub or Render password. Keep it out of the repository. Render supplies `PORT` and its public URL automatically.
6. Click **Deploy Web Service**. Once Render reports it is live, open its HTTPS URL and enter your Orbit password.

If you upload the whole `orbit-browser` folder inside another repository, set **Root Directory** to `orbit-browser` instead. A `render.yaml` is also included for Blueprint deployments; the manual Web Service flow above is sufficient.

Render currently advertises free web services without a credit card. Free services sleep after 15 minutes with no inbound traffic and may take around a minute to wake. Usage limits can pause the service. If your account is asked for a card, stop there; this project does not require selecting a paid plan. Do not add paid databases or disks. These are hosting limitations, not something the app can remove.

Official references, checked October 1, 2026:
- https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026
- https://render.com/docs/free
- https://render.com/docs/websocket

## Run on your own computer

Install Node.js 22 or 24, open a terminal in this folder, then:

```sh
npm ci --ignore-scripts
npm start
```

Open http://localhost:8080. Local preview binds only to your computer and does not require a password. To use a password in PowerShell:

```powershell
$env:ACCESS_PASSWORD = 'choose-a-long-workspace-password'
npm start
```

For a different host or domain, set `HOST=0.0.0.0`, `ACCESS_PASSWORD`, and `PUBLIC_ORIGIN` to the exact public HTTPS origin, such as `https://your-domain.example`. Public binding requires a password. Do not set `PUBLIC_ORIGIN` to a placeholder on Render: it uses `RENDER_EXTERNAL_URL` automatically. Service workers require HTTPS except on localhost.

## What to expect

- A working relay must remain online. Uploading these files to a static host such as Neocities will not run it. InfinityFree prohibits proxy scripts.
- Scramjet compatibility varies. Some sign-ins, media, downloads, and pop-ups will not work. This app deliberately blocks pop-ups and top-level navigation from framed pages.
- This does not disable Cisco Umbrella or GoGuardian. A managed network or device may still block the site/connection or monitor activity. It is not an anonymity guarantee.
- Tabs are kept in memory. Reloading Orbit closes them. Website storage/cookies can persist in this browser; **? → Clear browsing data & sign out** removes workspace storage and signs out. Host sessions expire after eight hours or a server restart.
- The relay accepts authenticated, same-origin connections and only web ports 80/443. Direct IP addresses and private/loopback destinations are blocked in production.
- Use a separate origin for this proxy. Do not put it on the same origin as an unrelated app containing sensitive data.

## Checks

`npm run check` checks JavaScript syntax. `node test/smoke.cjs` runs the end-to-end suite when Playwright and Chromium are installed. For a local development install, use `npm install --no-save playwright` and `npx playwright install chromium`. You can instead set `PLAYWRIGHT_MODULE` to an existing Playwright module path and `CHROME_PATH` to an existing Chromium browser executable.

The test runs a local fixture through the actual Scramjet/Wisp stack in an isolated child process. It checks authentication, external-origin rejection, JavaScript, frame-blocking headers, links, form submission, navigation, tabs, desktop/mobile layout, and data clearing. Private-address access is enabled only inside the test child for the fixture; production settings are unchanged. No external websites are contacted by that suite.

## Open source components

- [Scramjet 1.1.0](https://github.com/MercuryWorkshop/scramjet/tree/v1.1.0): MIT. The browser API matches the upstream Scramjet example app.
- [Bare Mux 2.1.9](https://github.com/MercuryWorkshop/bare-mux): see upstream license.
- [libcurl transport 1.5.2](https://github.com/MercuryWorkshop/libcurl-transport): AGPL-3.0-only.
- [Wisp JS 0.4.1](https://github.com/MercuryWorkshop/wisp-client-js): see upstream license.

Versions and integrity hashes are recorded in `package-lock.json`. Upstream libraries are unmodified. Keep their license notices and corresponding source available when redistributing. The in-app About dialog links to the upstream projects and this application's source archive. Regenerate `public/source.zip` from the source files after changing the app; exclude secrets, `.env`, `node_modules`, and the archive itself.
