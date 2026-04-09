# Privacy Policy for Page to AI

_Last updated: 2026-04-09_

Page to AI is a Chrome extension that extracts the content of the active webpage and forwards it to an AI chat service of the user's choice. This document explains exactly what data the extension handles.

## What we collect

**Nothing.** Page to AI does not collect, transmit, or store any data on any server operated by the developer. There is no analytics, no telemetry, and no backend.

## What the extension reads

When you click the Page to AI toolbar icon, the extension:

1. Reads the text and/or HTML content of the **currently active tab** (only that tab, only at that moment).
2. Opens the AI chat URL you configured in the extension's settings.
3. Sends the extracted content to that AI page as a file attachment, along with a prompt template you configured.

The extension only acts on an explicit user gesture (the toolbar click). It does not run in the background, does not monitor your browsing, and does not read any tab you have not explicitly chosen to send.

## What is stored locally

Your settings — target AI URL, prompt template, CSS selectors, profile presets — are stored using Chrome's built-in `chrome.storage.sync` API. This means:

- Settings stay on your device and sync across your own Chrome installations via your Google account, the same way bookmarks do.
- The developer has no access to this data.
- No webpage content or extracted text is ever stored — it is only passed through to the AI page you chose.

## Third parties

Page to AI sends extracted webpage content to **the AI service URL you configured** (e.g. claude.ai, chatgpt.com, or any other URL you set). That AI service is a third party, and its own privacy policy governs what it does with the content you send. Page to AI does not transmit data to anyone else.

## Permissions explained

- **activeTab** — read the current tab when you click the toolbar icon
- **storage** — save your settings via Chrome Sync
- **scripting** — inject the extraction and attachment scripts into pages
- **host permissions (`<all_urls>`)** — required because the source page and target AI page can be on any domain you configure

## Contact

Questions or concerns? Open an issue at https://github.com/apostx/page-to-ai/issues
