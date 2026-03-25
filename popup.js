/* global loadAllProfiles, setActiveProfile */

const profileSelect = document.getElementById("profileSelect");
const sendBtn = document.getElementById("send-btn");
const statusEl = document.getElementById("status");
const optionsLink = document.getElementById("options-link");

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (type ? " " + type : "");
}

// Load profiles into dropdown
async function initProfiles() {
  const { activeProfileId, profiles } = await loadAllProfiles();
  profileSelect.innerHTML = "";

  const builtIn = [];
  const custom = [];
  for (const [id, profile] of Object.entries(profiles)) {
    if (profile.builtIn) builtIn.push([id, profile]);
    else custom.push([id, profile]);
  }
  custom.sort((a, b) => a[1].name.localeCompare(b[1].name));

  for (const [id, profile] of [...builtIn, ...custom]) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = profile.name;
    if (id === activeProfileId) opt.selected = true;
    profileSelect.appendChild(opt);
  }
}

initProfiles();

profileSelect.addEventListener("change", async () => {
  await setActiveProfile(profileSelect.value);
});

sendBtn.addEventListener("click", async () => {
  sendBtn.disabled = true;
  setStatus("Extracting page content...");

  try {
    const response = await chrome.runtime.sendMessage({ action: "extract-and-send" });
    if (response?.error) {
      setStatus(response.error, "error");
      sendBtn.disabled = false;
    } else {
      setStatus("Sent! Opening AI page...", "success");
      setTimeout(() => window.close(), 1500);
    }
  } catch (err) {
    setStatus("Error: " + err.message, "error");
    sendBtn.disabled = false;
  }
});

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
