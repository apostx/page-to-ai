/* global chrome */

const SETTINGS_DEFAULTS = {
  targetUrl: "",
  prompt: "create a targeted cv for this job (get_cv_instructions on mcp)",
  chatInputSelector: "",
  fileDropSelector: "",
  attachmentMethod: "paste",
  extractionMode: "full",
  autoSubmit: false,
  submitButtonSelector: "",
  pickerPlaceholder: "hello",
};

const BUILTIN_PROFILES = {
  claude: {
    name: "Claude",
    builtIn: true,
    settings: {
      ...SETTINGS_DEFAULTS,
      targetUrl: "https://claude.ai/new",
      chatInputSelector: "div.ProseMirror",
      fileDropSelector: "div.ProseMirror",
      submitButtonSelector: "button[aria-label='Send message']",
    },
  },
  chatgpt: {
    name: "ChatGPT",
    builtIn: true,
    settings: {
      ...SETTINGS_DEFAULTS,
      targetUrl: "https://chatgpt.com/",
      chatInputSelector: "#prompt-textarea",
      fileDropSelector: "#prompt-textarea",
      submitButtonSelector: "button[data-testid='send-button']",
    },
  },
};

const DEFAULT_ACTIVE_PROFILE = "claude";

async function loadAllProfiles() {
  const data = await chrome.storage.sync.get({
    activeProfileId: DEFAULT_ACTIVE_PROFILE,
    profiles: null,
  });

  if (!data.profiles) {
    data.profiles = await migrateFromFlat();
  }

  return data;
}

async function migrateFromFlat() {
  const oldKeys = Object.keys(SETTINGS_DEFAULTS);
  const oldData = await chrome.storage.sync.get(oldKeys);
  const hasOldData = oldKeys.some((k) => oldData[k] !== undefined);

  const profiles = JSON.parse(JSON.stringify(BUILTIN_PROFILES));

  if (hasOldData) {
    for (const key of oldKeys) {
      if (oldData[key] !== undefined) {
        profiles.claude.settings[key] = oldData[key];
      }
    }
    await chrome.storage.sync.remove(oldKeys);
  }

  await chrome.storage.sync.set({
    activeProfileId: DEFAULT_ACTIVE_PROFILE,
    profiles,
  });

  return profiles;
}

async function getActiveSettings() {
  const { activeProfileId, profiles } = await loadAllProfiles();
  const profile = profiles[activeProfileId];
  if (!profile) {
    return { ...BUILTIN_PROFILES[DEFAULT_ACTIVE_PROFILE].settings };
  }
  return { ...SETTINGS_DEFAULTS, ...profile.settings };
}

async function saveProfile(profileId, settings) {
  const { profiles } = await loadAllProfiles();
  if (!profiles[profileId]) return;
  profiles[profileId].settings = settings;
  await chrome.storage.sync.set({ profiles });
}

async function setActiveProfile(profileId) {
  await chrome.storage.sync.set({ activeProfileId: profileId });
}

async function createProfile(name) {
  const { profiles } = await loadAllProfiles();
  const id = "custom_" + Date.now();
  profiles[id] = {
    name,
    builtIn: false,
    settings: { ...SETTINGS_DEFAULTS },
  };
  await chrome.storage.sync.set({ profiles });
  return id;
}

async function copyProfile(sourceProfileId, newName) {
  const { profiles } = await loadAllProfiles();
  const source = profiles[sourceProfileId];
  if (!source) return null;
  const id = "custom_" + Date.now();
  profiles[id] = {
    name: newName,
    builtIn: false,
    settings: { ...source.settings },
  };
  await chrome.storage.sync.set({ profiles });
  return id;
}

async function deleteProfile(profileId) {
  const data = await loadAllProfiles();
  if (data.profiles[profileId]?.builtIn) return false;
  delete data.profiles[profileId];
  if (data.activeProfileId === profileId) {
    data.activeProfileId = DEFAULT_ACTIVE_PROFILE;
  }
  await chrome.storage.sync.set({
    profiles: data.profiles,
    activeProfileId: data.activeProfileId,
  });
  return true;
}

async function resetBuiltInProfile(profileId) {
  if (!BUILTIN_PROFILES[profileId]) return false;
  const { profiles } = await loadAllProfiles();
  profiles[profileId] = JSON.parse(JSON.stringify(BUILTIN_PROFILES[profileId]));
  await chrome.storage.sync.set({ profiles });
  return true;
}
