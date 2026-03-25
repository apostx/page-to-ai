(() => {
  const OVERLAY_ID = "__page-to-ai-picker-overlay__";
  const TOOLTIP_ID = "__page-to-ai-picker-tooltip__";
  const STYLE_ID = "__page-to-ai-picker-style__";

  let fieldId = null;
  let chatInputSelector = null;
  let hoveredElement = null;
  let overlay = null;
  let tooltip = null;
  let styleEl = null;

  // Guard against re-injection
  function cleanupPrevious() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(TOOLTIP_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  let placeholderText = "hello";

  async function init(fid, inputSelector, placeholder) {
    cleanupPrevious();
    fieldId = fid;
    chatInputSelector = inputSelector;
    placeholderText = placeholder || "hello";

    // Auto-type a placeholder to reveal hidden UI elements (e.g. send button)
    await typePlaceholder(chatInputSelector);

    // Crosshair cursor
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = "* { cursor: crosshair !important; }";
    document.head.appendChild(styleEl);

    // Highlight overlay
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      background: "rgba(66, 133, 244, 0.25)",
      border: "2px solid rgba(66, 133, 244, 0.8)",
      borderRadius: "2px",
      transition: "all 0.05s ease",
      display: "none",
    });
    document.body.appendChild(overlay);

    // Tooltip
    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    Object.assign(tooltip.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      background: "#1a1a1a",
      color: "#fff",
      fontSize: "12px",
      fontFamily: "monospace",
      padding: "4px 8px",
      borderRadius: "4px",
      maxWidth: "400px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      display: "none",
    });
    document.body.appendChild(tooltip);

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  function cleanup() {
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    clearPlaceholder(chatInputSelector);
    overlay?.remove();
    tooltip?.remove();
    styleEl?.remove();
    overlay = null;
    tooltip = null;
    styleEl = null;
    hoveredElement = null;
  }

  async function typePlaceholder(selector) {
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!el) return;

    el.focus();
    if (el.isContentEditable) {
      document.execCommand("insertText", false, placeholderText);
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, placeholderText);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Wait for UI to react (e.g. send button to appear)
    await new Promise((r) => setTimeout(r, 500));
  }

  function clearPlaceholder(selector) {
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!el) return;

    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function handleMouseMove(e) {
    // Hide overlay temporarily so elementFromPoint doesn't hit it
    if (overlay) overlay.style.display = "none";
    if (tooltip) tooltip.style.display = "none";

    const el = document.elementFromPoint(e.clientX, e.clientY);

    if (overlay) overlay.style.display = "";
    if (tooltip) tooltip.style.display = "";

    if (!el || el === document.body || el === document.documentElement) {
      if (overlay) overlay.style.display = "none";
      if (tooltip) tooltip.style.display = "none";
      hoveredElement = null;
      return;
    }

    hoveredElement = el;
    const rect = el.getBoundingClientRect();

    if (overlay) {
      Object.assign(overlay.style, {
        display: "",
        top: rect.top + "px",
        left: rect.left + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
    }

    if (tooltip) {
      const selector = generateSelector(el);
      tooltip.textContent = selector;
      Object.assign(tooltip.style, {
        display: "",
        top: Math.min(e.clientY + 16, window.innerHeight - 30) + "px",
        left: Math.min(e.clientX + 12, window.innerWidth - 420) + "px",
      });
    }
  }

  function handleClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();

    if (!hoveredElement) return;

    const selector = generateSelector(hoveredElement);
    chrome.runtime.sendMessage({
      action: "picker-result",
      selector,
      fieldId,
    });
    cleanup();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      chrome.runtime.sendMessage({
        action: "picker-cancelled",
        fieldId,
      });
      cleanup();
    }
  }

  // --- Selector Generation ---

  function generateSelector(el) {
    // Priority 1: unique ID
    if (el.id) {
      const sel = "#" + CSS.escape(el.id);
      if (isUnique(sel, el)) return sel;
    }

    // Priority 2: unique attribute selector
    const attrSel = tryAttributeSelector(el);
    if (attrSel) return attrSel;

    // Priority 3: tag + classes
    const classSel = tryClassSelector(el);
    if (classSel) return classSel;

    // Priority 4: nth-child path
    return buildNthChildPath(el);
  }

  function tryAttributeSelector(el) {
    const tag = el.tagName.toLowerCase();
    const attrs = ["aria-label", "data-testid", "data-cy", "name", "role", "type", "placeholder"];

    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (!val) continue;

      const sel = `${tag}[${attr}=${CSS.escape(val)}]`;
      if (isUnique(sel, el)) return sel;
    }
    return null;
  }

  function tryClassSelector(el) {
    if (!el.classList.length) return null;
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).map((c) => "." + CSS.escape(c)).join("");
    const sel = tag + classes;
    if (isUnique(sel, el)) return sel;
    return null;
  }

  function buildNthChildPath(el) {
    const parts = [];
    let current = el;

    for (let depth = 0; depth < 5 && current && current !== document.body; depth++) {
      // If this ancestor has a unique ID, start from here
      if (current.id) {
        parts.unshift("#" + CSS.escape(current.id));
        break;
      }

      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }

      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current.tagName
      );
      if (siblings.length === 1) {
        parts.unshift(tag);
      } else {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
      }

      // Check if accumulated path is already unique
      const candidate = parts.join(" > ");
      if (isUnique(candidate, el)) return candidate;

      current = parent;
    }

    const result = parts.join(" > ");

    // Validate
    if (isUnique(result, el)) return result;

    // Last resort: very specific path
    return result;
  }

  function isUnique(selector, el) {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === el;
    } catch {
      return false;
    }
  }

  // --- Message Listener ---

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "start-picker") {
      init(message.fieldId, message.chatInputSelector, message.pickerPlaceholder);
    }
  });
})();
