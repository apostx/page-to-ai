/* global chrome */

// Storage layout:
//   chrome.storage.sync:
//     profiles[id].settings.driveAttachments: [{ fileId, name, mimeType, size }]
//     globalDriveAttachments: [{ fileId, name, mimeType, size }]
//   chrome.storage.local:
//     localAttachmentBlobs: { [id]: { data: base64String } }
//     globalLocalAttachments: [{ id, name, mimeType, size }]
//     profileLocalAttachments: { [profileId]: [{ id, name, mimeType, size }] }

// --- Local blob storage (per-machine) ---

async function addLocalAttachment(file) {
  const id = "local_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const data = await fileToBase64(file);
  const { localAttachmentBlobs = {} } = await chrome.storage.local.get("localAttachmentBlobs");
  localAttachmentBlobs[id] = { data };
  await chrome.storage.local.set({ localAttachmentBlobs });
  return { id, name: file.name, mimeType: file.type || "application/octet-stream", size: file.size };
}

async function removeLocalBlob(id) {
  const { localAttachmentBlobs = {} } = await chrome.storage.local.get("localAttachmentBlobs");
  delete localAttachmentBlobs[id];
  await chrome.storage.local.set({ localAttachmentBlobs });
}

async function getLocalBlob(id) {
  const { localAttachmentBlobs = {} } = await chrome.storage.local.get("localAttachmentBlobs");
  return localAttachmentBlobs[id] || null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- Global attachment lists ---

async function getGlobalAttachments() {
  const sync = await chrome.storage.sync.get({ globalDriveAttachments: [] });
  const local = await chrome.storage.local.get({ globalLocalAttachments: [] });
  return {
    drive: sync.globalDriveAttachments,
    local: local.globalLocalAttachments,
  };
}

async function setGlobalDriveAttachments(list) {
  await chrome.storage.sync.set({ globalDriveAttachments: list });
}

async function setGlobalLocalAttachments(list) {
  await chrome.storage.local.set({ globalLocalAttachments: list });
}

// --- Profile attachment lists ---

async function getProfileAttachments(profileId) {
  const { profiles = {} } = await chrome.storage.sync.get({ profiles: {} });
  const { profileLocalAttachments = {} } = await chrome.storage.local.get("profileLocalAttachments");
  return {
    drive: (profiles[profileId]?.settings?.driveAttachments) || [],
    local: profileLocalAttachments[profileId] || [],
  };
}

async function setProfileDriveAttachments(profileId, list) {
  const { profiles = {} } = await chrome.storage.sync.get({ profiles: {} });
  if (!profiles[profileId]) return;
  profiles[profileId].settings = profiles[profileId].settings || {};
  profiles[profileId].settings.driveAttachments = list;
  await chrome.storage.sync.set({ profiles });
}

async function setProfileLocalAttachments(profileId, list) {
  const { profileLocalAttachments = {} } = await chrome.storage.local.get("profileLocalAttachments");
  profileLocalAttachments[profileId] = list;
  await chrome.storage.local.set({ profileLocalAttachments });
}

// --- Drive metadata refresh (after successful fetch) ---

async function updateDriveAttachmentSizes(profileId, updates) {
  // updates: [{ scope, fileId, size }]
  const globalUpdates = new Map();
  const profileUpdates = new Map();
  for (const u of updates) {
    (u.scope === "global" ? globalUpdates : profileUpdates).set(u.fileId, u.size);
  }

  if (globalUpdates.size) {
    const { globalDriveAttachments = [] } = await chrome.storage.sync.get({ globalDriveAttachments: [] });
    let changed = false;
    const next = globalDriveAttachments.map((a) => {
      if (globalUpdates.has(a.fileId) && a.size !== globalUpdates.get(a.fileId)) {
        changed = true;
        return { ...a, size: globalUpdates.get(a.fileId) };
      }
      return a;
    });
    if (changed) await chrome.storage.sync.set({ globalDriveAttachments: next });
  }

  if (profileUpdates.size && profileId) {
    const { profiles = {} } = await chrome.storage.sync.get({ profiles: {} });
    const list = profiles[profileId]?.settings?.driveAttachments;
    if (list) {
      let changed = false;
      profiles[profileId].settings.driveAttachments = list.map((a) => {
        if (profileUpdates.has(a.fileId) && a.size !== profileUpdates.get(a.fileId)) {
          changed = true;
          return { ...a, size: profileUpdates.get(a.fileId) };
        }
        return a;
      });
      if (changed) await chrome.storage.sync.set({ profiles });
    }
  }
}

async function removeDriveAttachments(profileId, removals) {
  // removals: [{ scope, fileId }] — drops refs whose fileId is no longer
  // fetchable (404/403 at send time).
  const globalRemoves = new Set();
  const profileRemoves = new Set();
  for (const r of removals) {
    (r.scope === "global" ? globalRemoves : profileRemoves).add(r.fileId);
  }

  if (globalRemoves.size) {
    const { globalDriveAttachments = [] } = await chrome.storage.sync.get({ globalDriveAttachments: [] });
    const next = globalDriveAttachments.filter((a) => !globalRemoves.has(a.fileId));
    if (next.length !== globalDriveAttachments.length) {
      await chrome.storage.sync.set({ globalDriveAttachments: next });
    }
  }

  if (profileRemoves.size && profileId) {
    const { profiles = {} } = await chrome.storage.sync.get({ profiles: {} });
    const list = profiles[profileId]?.settings?.driveAttachments;
    if (list) {
      const next = list.filter((a) => !profileRemoves.has(a.fileId));
      if (next.length !== list.length) {
        profiles[profileId].settings.driveAttachments = next;
        await chrome.storage.sync.set({ profiles });
      }
    }
  }
}

async function removeLocalAttachments(profileId, removals) {
  // removals: [{ scope, id }] — drops refs whose blob is no longer present
  // (e.g. storage was cleared out of band).
  const globalRemoves = new Set();
  const profileRemoves = new Set();
  for (const r of removals) {
    (r.scope === "global" ? globalRemoves : profileRemoves).add(r.id);
  }

  if (globalRemoves.size) {
    const { globalLocalAttachments = [] } = await chrome.storage.local.get({ globalLocalAttachments: [] });
    const next = globalLocalAttachments.filter((a) => !globalRemoves.has(a.id));
    if (next.length !== globalLocalAttachments.length) {
      await chrome.storage.local.set({ globalLocalAttachments: next });
    }
  }

  if (profileRemoves.size && profileId) {
    const { profileLocalAttachments = {} } = await chrome.storage.local.get("profileLocalAttachments");
    const list = profileLocalAttachments[profileId];
    if (list) {
      const next = list.filter((a) => !profileRemoves.has(a.id));
      if (next.length !== list.length) {
        profileLocalAttachments[profileId] = next;
        await chrome.storage.local.set({ profileLocalAttachments });
      }
    }
  }
}

async function clearAllDriveAttachments() {
  const { profiles = {} } = await chrome.storage.sync.get({ profiles: {} });
  for (const id of Object.keys(profiles)) {
    if (profiles[id]?.settings?.driveAttachments) {
      profiles[id].settings.driveAttachments = [];
    }
  }
  await chrome.storage.sync.set({
    globalDriveAttachments: [],
    profiles,
  });
}

// --- Resolve to files at send time ---

async function resolveAttachmentsForSend(profileId) {
  const g = await getGlobalAttachments();
  const p = await getProfileAttachments(profileId);

  const ordered = [
    ...g.drive.map((a) => ({ ...a, source: "drive", scope: "global" })),
    ...g.local.map((a) => ({ ...a, source: "local", scope: "global" })),
    ...p.drive.map((a) => ({ ...a, source: "drive", scope: "profile" })),
    ...p.local.map((a) => ({ ...a, source: "local", scope: "profile" })),
  ];

  // Dedupe — a file in both global and profile counts once. Drive is keyed by
  // fileId; local is keyed by name+size+mimeType so a re-upload of the same
  // file also collapses. Global wins because it iterates first.
  const seen = new Set();
  const deduped = [];
  for (const entry of ordered) {
    const key = entry.source === "drive"
      ? `drive:${entry.fileId}`
      : `local:${entry.name}|${entry.size}|${entry.mimeType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  const resolved = [];
  const missingLocal = [];
  for (const entry of deduped) {
    try {
      if (entry.source === "local") {
        const blob = await getLocalBlob(entry.id);
        if (!blob) {
          missingLocal.push({ scope: entry.scope, id: entry.id });
          continue;
        }
        resolved.push({ name: entry.name, mimeType: entry.mimeType, data: blob.data });
      } else {
        // Drive — resolved in background.js where chrome.identity is available
        resolved.push({
          name: entry.name,
          mimeType: entry.mimeType,
          fileId: entry.fileId,
          scope: entry.scope,
          _needsDriveFetch: true,
        });
      }
    } catch (err) {
      console.error("Page to AI: failed to resolve attachment", entry, err);
    }
  }
  if (missingLocal.length) {
    removeLocalAttachments(profileId, missingLocal).catch((err) =>
      console.error("Page to AI: failed to remove stale local refs", err)
    );
  }
  return resolved;
}
