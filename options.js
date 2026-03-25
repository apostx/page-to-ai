/* global SETTINGS_DEFAULTS, BUILTIN_PROFILES, loadAllProfiles, saveProfile,
   setActiveProfile, createProfile, deleteProfile, resetBuiltInProfile */

const fields = {
  targetUrl: document.getElementById("targetUrl"),
  prompt: document.getElementById("prompt"),
  chatInputSelector: document.getElementById("chatInputSelector"),
  fileDropSelector: document.getElementById("fileDropSelector"),
  autoSubmit: document.getElementById("autoSubmit"),
  submitButtonSelector: document.getElementById("submitButtonSelector"),
  pickerPlaceholder: document.getElementById("pickerPlaceholder"),
};

const profileSelect = document.getElementById("profileSelect");
const deleteBtn = document.getElementById("delete-profile-btn");
const resetBtn = document.getElementById("reset-btn");
const submitSelectorField = document.getElementById("submitSelectorField");
const statusEl = document.getElementById("status");

let currentProfiles = {};
let currentActiveId = null;

// --- Initialization ---

async function init() {
  const data = await loadAllProfiles();
  currentProfiles = data.profiles;
  currentActiveId = data.activeProfileId;
  populateProfileDropdown();
  loadProfileIntoForm(currentActiveId);
}

init();

// --- Profile Dropdown ---

function populateProfileDropdown() {
  profileSelect.innerHTML = "";

  // Built-in profiles first, then custom
  const builtIn = [];
  const custom = [];
  for (const [id, profile] of Object.entries(currentProfiles)) {
    if (profile.builtIn) builtIn.push([id, profile]);
    else custom.push([id, profile]);
  }
  custom.sort((a, b) => a[1].name.localeCompare(b[1].name));

  for (const [id, profile] of [...builtIn, ...custom]) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = profile.name;
    if (id === currentActiveId) opt.selected = true;
    profileSelect.appendChild(opt);
  }
}

function loadProfileIntoForm(profileId) {
  const profile = currentProfiles[profileId];
  if (!profile) return;

  const s = { ...SETTINGS_DEFAULTS, ...profile.settings };

  fields.targetUrl.value = s.targetUrl;
  fields.prompt.value = s.prompt;
  fields.chatInputSelector.value = s.chatInputSelector;
  fields.fileDropSelector.value = s.fileDropSelector;
  fields.autoSubmit.checked = s.autoSubmit;
  fields.submitButtonSelector.value = s.submitButtonSelector;
  fields.pickerPlaceholder.value = s.pickerPlaceholder;

  document.querySelector(`input[name="extractionMode"][value="${s.extractionMode}"]`).checked = true;
  document.querySelector(`input[name="attachmentMethod"][value="${s.attachmentMethod}"]`).checked = true;

  toggleSubmitSelector();

  // Show/hide delete and reset buttons based on profile type
  deleteBtn.style.display = profile.builtIn ? "none" : "";
  resetBtn.style.display = profile.builtIn ? "" : "none";
}

profileSelect.addEventListener("change", async () => {
  currentActiveId = profileSelect.value;
  await setActiveProfile(currentActiveId);
  loadProfileIntoForm(currentActiveId);
  setStatus("");
});

// --- Auto-submit toggle ---

function toggleSubmitSelector() {
  submitSelectorField.style.display = fields.autoSubmit.checked ? "" : "none";
}

fields.autoSubmit.addEventListener("change", toggleSubmitSelector);

// --- Save ---

document.getElementById("save-btn").addEventListener("click", async () => {
  const settings = {
    targetUrl: fields.targetUrl.value.trim(),
    prompt: fields.prompt.value.trim(),
    chatInputSelector: fields.chatInputSelector.value.trim(),
    fileDropSelector: fields.fileDropSelector.value.trim(),
    extractionMode: document.querySelector('input[name="extractionMode"]:checked').value,
    attachmentMethod: document.querySelector('input[name="attachmentMethod"]:checked').value,
    autoSubmit: fields.autoSubmit.checked,
    submitButtonSelector: fields.submitButtonSelector.value.trim(),
    pickerPlaceholder: fields.pickerPlaceholder.value.trim() || SETTINGS_DEFAULTS.pickerPlaceholder,
  };

  if (!settings.targetUrl) {
    setStatus("Target URL is required.", "error");
    return;
  }

  await saveProfile(currentActiveId, settings);
  currentProfiles[currentActiveId].settings = settings;
  setStatus("Settings saved.", "success");
  setTimeout(() => setStatus(""), 2000);
});

// --- Reset to Default (built-in profiles only) ---

resetBtn.addEventListener("click", async () => {
  await resetBuiltInProfile(currentActiveId);
  const data = await loadAllProfiles();
  currentProfiles = data.profiles;
  loadProfileIntoForm(currentActiveId);
  setStatus("Defaults restored.", "success");
  setTimeout(() => setStatus(""), 2000);
});

// --- Add Profile ---

document.getElementById("add-profile-btn").addEventListener("click", async () => {
  const name = prompt("Profile name:");
  if (!name || !name.trim()) return;

  const newId = await createProfile(name.trim());
  const data = await loadAllProfiles();
  currentProfiles = data.profiles;
  currentActiveId = newId;
  await setActiveProfile(newId);
  populateProfileDropdown();
  loadProfileIntoForm(newId);
  setStatus("Profile created. Fill in the settings and save.", "success");
});

// --- Delete Profile ---

deleteBtn.addEventListener("click", async () => {
  const profile = currentProfiles[currentActiveId];
  if (!profile || profile.builtIn) return;
  if (!confirm(`Delete profile "${profile.name}"?`)) return;

  await deleteProfile(currentActiveId);
  const data = await loadAllProfiles();
  currentProfiles = data.profiles;
  currentActiveId = data.activeProfileId;
  populateProfileDropdown();
  loadProfileIntoForm(currentActiveId);
  setStatus("Profile deleted.", "success");
  setTimeout(() => setStatus(""), 2000);
});

// --- Status ---

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.style.color = type === "error" ? "#d93025" : type === "success" ? "#188038" : "#666";
}

// --- Element Picker ---

let pickerActive = false;
let optionsTabId = null;
let pickerTabId = null;

chrome.tabs.getCurrent().then((tab) => {
  optionsTabId = tab?.id;
});

document.querySelectorAll(".pick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    startPicker(btn.dataset.field);
  });
});

async function startPicker(fieldId) {
  if (pickerActive) return;
  pickerActive = true;

  setStatus("Opening target page for picking...");
  document.querySelectorAll(".pick-btn").forEach((b) => (b.disabled = true));

  try {
    const targetUrl = fields.targetUrl.value.trim() || SETTINGS_DEFAULTS.targetUrl;

    const newTab = await chrome.tabs.create({ url: targetUrl });
    pickerTabId = newTab.id;

    await waitForTabLoad(newTab.id);

    setStatus("Pick an element on the page... (Escape to cancel)");

    await chrome.scripting.executeScript({
      target: { tabId: newTab.id },
      files: ["content-picker.js"],
    });

    await chrome.tabs.sendMessage(newTab.id, {
      action: "start-picker",
      fieldId,
      chatInputSelector: fields.chatInputSelector.value.trim() || SETTINGS_DEFAULTS.chatInputSelector,
      pickerPlaceholder: fields.pickerPlaceholder.value.trim() || SETTINGS_DEFAULTS.pickerPlaceholder,
    });
  } catch (err) {
    setStatus("Picker failed: " + err.message, "error");
    closePickerTab();
    finishPicker();
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timed out"));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function closePickerTab() {
  if (pickerTabId != null) {
    try {
      await chrome.tabs.remove(pickerTabId);
    } catch {
      // Tab may already be closed
    }
    pickerTabId = null;
  }
}

function finishPicker() {
  pickerActive = false;
  document.querySelectorAll(".pick-btn").forEach((b) => (b.disabled = false));
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "picker-result") {
    fields[message.fieldId].value = message.selector;
    setStatus("Selector picked: " + message.selector);
    setTimeout(() => setStatus(""), 3000);
    closePickerTab();
    finishPicker();
    switchBackToOptions();
  }
  if (message.action === "picker-cancelled") {
    setStatus("");
    closePickerTab();
    finishPicker();
    switchBackToOptions();
  }
});

async function switchBackToOptions() {
  if (optionsTabId != null) {
    try {
      await chrome.tabs.update(optionsTabId, { active: true });
      const tab = await chrome.tabs.get(optionsTabId);
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      // Tab may have been closed
    }
  }
}
