/* global chrome */

// Google Drive integration. OAuth client is declared in manifest.oauth2.
// See docs/DRIVE_SETUP.md.

async function getDriveAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No token"));
      } else {
        resolve(token);
      }
    });
  });
}

async function revokeDriveAuthToken(token) {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
  } catch {
    // ignore
  }
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// Opens a custom Drive file browser (modal in the host page, using the Drive
// REST API). Resolves with the picked file ref { fileId, name, mimeType, size }
// or null if cancelled.
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

async function openDrivePicker() {
  let token = await getDriveAuthToken(true);

  async function drvFetch(url) {
    let resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.status === 401) {
      await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
      token = await getDriveAuthToken(true);
      resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    return resp;
  }

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "drive-browser-backdrop";
    backdrop.tabIndex = -1;
    backdrop.innerHTML = `
      <div class="drive-browser-modal" role="dialog" aria-label="Select a file from Google Drive">
        <div class="drive-browser-header">
          <span class="drive-browser-title">Select a file from Google Drive</span>
          <button type="button" class="drive-browser-close" title="Close">&times;</button>
        </div>
        <div class="drive-browser-tabs">
          <button type="button" class="drive-browser-tab" data-root="my">My Drive</button>
          <button type="button" class="drive-browser-tab" data-root="shared">Shared with me</button>
        </div>
        <div class="drive-browser-breadcrumb"></div>
        <div class="drive-browser-search">
          <input type="text" class="drive-browser-search-input" placeholder="Search all of Drive..." />
        </div>
        <div class="drive-browser-list"></div>
        <div class="drive-browser-status"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const listEl = backdrop.querySelector(".drive-browser-list");
    const searchEl = backdrop.querySelector(".drive-browser-search-input");
    const statusEl = backdrop.querySelector(".drive-browser-status");
    const closeBtn = backdrop.querySelector(".drive-browser-close");
    const crumbEl = backdrop.querySelector(".drive-browser-breadcrumb");
    const tabEls = backdrop.querySelectorAll(".drive-browser-tab");

    const ROOTS = {
      my: { id: "root", name: "My Drive" },
      shared: { id: "__shared__", name: "Shared with me" },
    };
    let folderStack = [ROOTS.my];
    let nextPageToken = null;
    let loading = false;
    let currentQuery = "";
    let reqCounter = 0;

    function closeModal(result) {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }

    closeBtn.addEventListener("click", () => closeModal(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal(null);
    });
    function onKey(e) {
      if (e.key === "Escape") closeModal(null);
    }
    document.addEventListener("keydown", onKey);

    function currentFolder() {
      return folderStack[folderStack.length - 1];
    }

    function renderTabs() {
      const activeRoot = folderStack[0].id === "__shared__" ? "shared" : "my";
      tabEls.forEach((el) => {
        el.classList.toggle("active", el.dataset.root === activeRoot);
      });
    }

    tabEls.forEach((el) => {
      el.addEventListener("click", () => {
        const rootKey = el.dataset.root;
        folderStack = [ROOTS[rootKey]];
        currentQuery = "";
        searchEl.value = "";
        loadFiles(true);
      });
    });

    function renderBreadcrumb() {
      if (currentQuery.trim()) {
        crumbEl.innerHTML = `<span class="drive-browser-crumb-label">Search results</span>`;
        return;
      }
      const parts = folderStack.map((f, i) => {
        const isLast = i === folderStack.length - 1;
        return isLast
          ? `<span class="drive-browser-crumb drive-browser-crumb-current">${escapeHtml(f.name)}</span>`
          : `<span class="drive-browser-crumb" data-index="${i}">${escapeHtml(f.name)}</span>`;
      });
      crumbEl.innerHTML = parts.join(`<span class="drive-browser-crumb-sep">/</span>`);
      crumbEl.querySelectorAll(".drive-browser-crumb[data-index]").forEach((el) => {
        el.addEventListener("click", () => {
          const idx = Number(el.dataset.index);
          folderStack.splice(idx + 1);
          loadFiles(true);
        });
      });
    }

    function buildQuery() {
      const q = currentQuery.trim();
      if (q) {
        const safe = q.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        return `trashed = false and name contains '${safe}'`;
      }
      const cur = currentFolder();
      if (cur.id === "__shared__") {
        return `sharedWithMe = true and trashed = false`;
      }
      return `'${cur.id}' in parents and trashed = false`;
    }

    async function loadFiles(reset) {
      if (loading) return;
      loading = true;
      const reqId = ++reqCounter;
      if (reset) {
        listEl.innerHTML = "";
        nextPageToken = null;
      }
      renderTabs();
      renderBreadcrumb();
      statusEl.textContent = "Loading...";

      try {
        const params = new URLSearchParams({
          pageSize: "100",
          fields: "nextPageToken,files(id,name,mimeType,size,iconLink,modifiedTime)",
          orderBy: "folder,name",
          q: buildQuery(),
        });
        if (nextPageToken) params.set("pageToken", nextPageToken);

        const resp = await drvFetch(
          `https://www.googleapis.com/drive/v3/files?${params.toString()}`
        );
        if (reqId !== reqCounter) return;
        if (!resp.ok) throw new Error(`Drive API ${resp.status}`);
        const data = await resp.json();
        nextPageToken = data.nextPageToken || null;
        renderEntries(data.files || []);
        if (reset && (!data.files || !data.files.length)) {
          statusEl.textContent = currentQuery.trim() ? "No matches." : "Folder is empty.";
        } else {
          statusEl.textContent = "";
        }
      } catch (err) {
        statusEl.textContent = "Failed: " + err.message;
      } finally {
        loading = false;
      }
    }

    function renderEntries(files) {
      for (const f of files) {
        const isFolder = f.mimeType === DRIVE_FOLDER_MIME;
        const row = document.createElement("div");
        row.className = "drive-browser-row" + (isFolder ? " is-folder" : "");
        const iconHtml = isFolder
          ? `<span class="drive-browser-icon drive-browser-icon-folder">📁</span>`
          : `<img class="drive-browser-icon" src="${escapeAttr(f.iconLink || "")}" alt="" />`;
        row.innerHTML = `
          ${iconHtml}
          <span class="drive-browser-name" title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span>
          <span class="drive-browser-meta">${isFolder ? "" : f.size ? formatBytes(Number(f.size)) : ""}</span>
        `;
        row.addEventListener("click", () => {
          if (isFolder) {
            currentQuery = "";
            searchEl.value = "";
            folderStack.push({ id: f.id, name: f.name });
            loadFiles(true);
          } else {
            closeModal({
              fileId: f.id,
              name: f.name,
              mimeType: f.mimeType,
              size: f.size ? Number(f.size) : 0,
            });
          }
        });
        listEl.appendChild(row);
      }
    }

    function escapeAttr(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }
    function formatBytes(b) {
      if (b < 1024) return b + " B";
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
      return (b / (1024 * 1024)).toFixed(1) + " MB";
    }

    listEl.addEventListener("scroll", () => {
      if (!nextPageToken || loading) return;
      if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 50) {
        loadFiles(false);
      }
    });

    let searchTimer;
    searchEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentQuery = searchEl.value;
        loadFiles(true);
      }, 300);
    });

    loadFiles(true);
    setTimeout(() => searchEl.focus(), 0);
  });
}

// Fetch a Drive file as base64. Handles native binary files and
// Google-native docs (Docs/Sheets/Slides) by exporting them.
async function fetchDriveFile(token, fileId, cachedMimeType) {
  const metaResp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!metaResp.ok) throw new Error(`Drive metadata ${metaResp.status}`);
  const meta = await metaResp.json();
  const mimeType = meta.mimeType || cachedMimeType;

  const exportMap = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "application/pdf",
    "application/vnd.google-apps.drawing": "application/pdf",
  };

  let url, finalMime;
  if (exportMap[mimeType]) {
    finalMime = exportMap[mimeType];
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(finalMime)}`;
  } else {
    finalMime = mimeType;
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  }

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Drive fetch ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return { data: arrayBufferToBase64(buf), mimeType: finalMime, size: buf.byteLength };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
