# Publishing to the Chrome Web Store

This project auto-publishes to the Chrome Web Store when you push a version tag (`v*.*.*`) to GitHub. The workflow lives at [.github/workflows/publish.yml](../.github/workflows/publish.yml).

## One-time setup

### 1. First manual upload

The Chrome Web Store needs to know about the extension before the API can update it.

1. Run `npm run build` locally to produce `dist/page-to-ai-v1.0.0.zip`.
2. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Click **New item**, upload the zip, fill out the listing (description, screenshots, category, privacy practices), and submit.
4. After it's accepted, copy the **extension ID** from the dashboard URL — that's your `CWS_EXTENSION_ID`.

### 2. Enable the Chrome Web Store API

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create (or pick) a project.
3. **APIs & Services → Library** → search for "Chrome Web Store API" → **Enable**.

### 3. Create OAuth credentials

1. **APIs & Services → OAuth consent screen** → configure as **External**, add your email as a test user. You don't need to publish the consent screen — test mode is fine for personal use.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
3. Application type: **Desktop app**. Name it whatever you want.
4. Save the **Client ID** and **Client Secret** — these are `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET`.

### 4. Get a refresh token

This is the trickiest step — you need to do an OAuth flow once to get a long-lived refresh token.

The simplest approach: use `chrome-webstore-upload-keys` from npm.

```bash
npx chrome-webstore-upload-keys
```

It will prompt for your client ID and secret, open a browser for you to grant access, then print a refresh token. Save that as `CWS_REFRESH_TOKEN`.

### 5. Add secrets to GitHub

Go to your repo on GitHub → **Settings → Secrets and variables → Actions → New repository secret**. Add all four:

- `CWS_EXTENSION_ID`
- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

## Release flow

Once setup is done, releasing a new version is:

```bash
# 1. Bump the version in manifest.json (e.g. 1.0.0 → 1.0.1)
# 2. Commit the change
git add manifest.json
git commit -m "Bump version to 1.0.1"

# 3. Tag and push
git tag v1.0.1
git push origin main --tags
```

The workflow will:

1. Verify the tag matches `manifest.json` (fails fast if you forgot to bump).
2. Build the zip.
3. Upload it to the Chrome Web Store and trigger auto-publish.
4. Create a GitHub release with the zip attached.

The extension will go into Chrome's review queue. Reviews typically take a few days. You can check status in the developer dashboard.

## Notes

- **Why tags, not every push?** Every upload to the store triggers a fresh review. Tag-based releases give you explicit control and avoid spamming the review team.
- **Failed publish?** Check the Actions tab for logs. The most common failures are: expired refresh token (re-run step 4), version mismatch (manifest not bumped), or store rejection (check the dashboard).
- **Local testing of the build:** `npm run build` runs `node build.js` and produces a zip in `dist/`. You can load the zip's contents as an unpacked extension to verify before tagging.
