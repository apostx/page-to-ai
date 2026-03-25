importScripts("profiles.js");

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
      content: pendingAttachment.content,
      filename: pendingAttachment.filename,
      prompt: pendingAttachment.prompt,
      fileDropSelector: pendingAttachment.fileDropSelector,
      chatInputSelector: pendingAttachment.chatInputSelector,
      fileFormat: pendingAttachment.fileFormat,
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
  const fileFormat = isHtml ? "html" : "markdown";
  const filename = `page-content.${ext}`;

  // Open the AI page first to get the tabId
  const newTab = await chrome.tabs.create({ url: settings.targetUrl });

  // Store pending state with the known tabId for the onUpdated listener
  await chrome.storage.session.set({
    pendingAttachment: {
      tabId: newTab.id,
      content: extractedContent,
      filename,
      prompt: settings.prompt,
      fileDropSelector: settings.fileDropSelector,
      chatInputSelector: settings.chatInputSelector,
      fileFormat,
      attachmentMethod: settings.attachmentMethod,
      autoSubmit: settings.autoSubmit,
      submitButtonSelector: settings.submitButtonSelector,
    },
  });

  return { success: true };
}
