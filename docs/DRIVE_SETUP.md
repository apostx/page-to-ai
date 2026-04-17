# Google Drive Integration Setup

The "Add from Drive" attachment feature browses Google Drive via the Drive REST API and requires an OAuth 2.0 Chrome-extension client. Google Picker is **not** used (it's incompatible with Manifest V3 extension CSP).

## 1. Google Cloud project

Use your existing project or create a new one at <https://console.cloud.google.com/>.

## 2. Enable the Drive API

In the project, enable **Google Drive API** under <https://console.cloud.google.com/apis/library>.

(You do NOT need Google Picker API.)

## 3. Create the OAuth 2.0 Client ID (Chrome Extension type)

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Chrome Extension**
3. Item ID: your extension's ID. For the CWS build use the published extension ID (e.g. `abhfacaoknldihldhgdfdedoinpainhb`); for unpacked dev builds use the dev ID shown on `chrome://extensions`.
4. Save and copy the generated client ID (ends with `.apps.googleusercontent.com`).

Paste it into `manifest.json` → `oauth2.client_id`.

> **Dev note:** Chrome assigns a path-based ID to unpacked extensions, which differs from the CWS ID. If you want OAuth to work in both, either (a) create two OAuth clients and swap the manifest `client_id` at release time, or (b) add a `"key"` field to `manifest.json` equal to the CWS extension's public key to force dev ID → CWS ID.

## 4. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External**
3. Add scope `https://www.googleapis.com/auth/drive.readonly`
4. `drive.readonly` is a **sensitive** scope. For development / internal testing this is fine — users see an "unverified app" warning they must bypass. For a public CWS release you must submit the app for **Google OAuth verification** (can take several weeks).

## 5. Rebuild

After editing `manifest.json`:

```bash
node build.js
```

Then reload at `chrome://extensions` (dev) or upload to CWS (prod).

## Troubleshooting

- **"OAuth2 request failed: 'bad client id'"** — the `client_id` in the manifest doesn't match an OAuth client of type Chrome Extension, or the client's Item ID doesn't match the running extension's ID.
- **HTTP 403 on Drive API calls** — the cached auth token was issued with an older/narrower scope. Revoke access at <https://myaccount.google.com/permissions> (find "Page to AI") then retry "Add from Drive".
- **"This app isn't verified"** — expected during development. Click **Advanced → Go to Page to AI (unsafe)** to continue. For public release, complete Google OAuth verification.
