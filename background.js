importScripts("profiles.js", "attachments.js", "drive.js");

// Top-level listener — survives service worker restarts
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;

  const { pendingAttachment } = await chrome.storage.session.get("pendingAttachment");
  if (!pendingAttachment || pendingAttachment.tabId !== tabId) return;

  // Clean up immediately to prevent re-firing
  await chrome.storage.session.remove("pendingAttachment");

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-attach.js"],
    });

    await chrome.tabs.sendMessage(tabId, {
      action: "attach-and-type",
      attachments: pendingAttachment.attachments,
      prompt: pendingAttachment.prompt,
      fileDropSelector: pendingAttachment.fileDropSelector,
      chatInputSelector: pendingAttachment.chatInputSelector,
      attachmentMethod: pendingAttachment.attachmentMethod,
      autoSubmit: pendingAttachment.autoSubmit,
      submitButtonSelector: pendingAttachment.submitButtonSelector,
    });
  } catch (err) {
    console.error("Page to AI: failed to inject into target tab", err);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "extract-and-send") {
    handleExtractAndSend().then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true; // keep message channel open for async response
  }
});

async function handleExtractAndSend() {
  const { activeProfileId } = await loadAllProfiles();
  const settings = await getActiveSettings();

  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found");

  // Set extraction mode as a global variable before running the extraction script
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (mode) => { globalThis.__pageToAiExtractionMode = mode; },
    args: [settings.extractionMode],
  });

  // Inject Readability if smart mode
  if (settings.extractionMode === "smart") {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/Readability.js"],
    });
  }

  const [{ result: extractedContent }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content-extract.js"],
  });

  if (!extractedContent) {
    throw new Error("Failed to extract page content");
  }

  const isHtml = settings.extractionMode === "full";
  const ext = isHtml ? "html" : "md";
  const pageMimeType = isHtml ? "text/html" : "text/markdown";
  const pageFilename = `page-content.${ext}`;

  // Gather user attachments (global + profile, drive + local)
  const userAttachments = await resolveAttachmentsForSend(activeProfileId);

  // Fetch Drive content for any drive-source attachments
  const hasDrive = userAttachments.some((a) => a._needsDriveFetch);
  const finalAttachments = [];
  if (hasDrive) {
    let token;
    try {
      token = await getDriveAuthToken(false);
    } catch {
      // Interactive fallback — the user may need to consent
      try {
        token = await getDriveAuthToken(true);
      } catch (err) {
        console.error("Page to AI: Drive auth failed", err);
      }
    }
    const sizeUpdates = [];
    const staleRemovals = [];
    for (const a of userAttachments) {
      if (a._needsDriveFetch) {
        if (!token) continue;
        try {
          const fetched = await fetchDriveFile(token, a.fileId, a.mimeType);
          finalAttachments.push({ name: a.name, mimeType: fetched.mimeType, data: fetched.data });
          sizeUpdates.push({ scope: a.scope, fileId: a.fileId, size: fetched.size });
        } catch (err) {
          console.error("Page to AI: failed to fetch Drive file", a, err);
          if (err.status === 404 || err.status === 403) {
            staleRemovals.push({ scope: a.scope, fileId: a.fileId });
          }
        }
      } else {
        finalAttachments.push(a);
      }
    }
    if (sizeUpdates.length) {
      updateDriveAttachmentSizes(activeProfileId, sizeUpdates).catch((err) =>
        console.error("Page to AI: failed to update Drive sizes", err)
      );
    }
    if (staleRemovals.length) {
      removeDriveAttachments(activeProfileId, staleRemovals).catch((err) =>
        console.error("Page to AI: failed to remove stale Drive refs", err)
      );
    }
  } else {
    for (const a of userAttachments) finalAttachments.push(a);
  }

  // Extracted page goes LAST (closest to prompt)
  finalAttachments.push({
    name: pageFilename,
    mimeType: pageMimeType,
    data: utf8ToBase64(extractedContent),
  });

  // Open the AI page first to get the tabId
  const newTab = await chrome.tabs.create({ url: settings.targetUrl });

  // Store pending state with the known tabId for the onUpdated listener
  await chrome.storage.session.set({
    pendingAttachment: {
      tabId: newTab.id,
      attachments: finalAttachments,
      prompt: settings.prompt,
      fileDropSelector: settings.fileDropSelector,
      chatInputSelector: settings.chatInputSelector,
      attachmentMethod: settings.attachmentMethod,
      autoSubmit: settings.autoSubmit,
      submitButtonSelector: settings.submitButtonSelector,
    },
  });

  return { success: true };
}

function utf8ToBase64(str) {
  // Encode a string (extracted HTML/markdown) as base64 so it shares the
  // same wire format as file-based attachments.
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
