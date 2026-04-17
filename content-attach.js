(() => {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "attach-and-type") {
      performAttachment(message);
    }
  });

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element "${selector}" not found within ${timeout}ms`));
      }, timeout);
    });
  }

  async function performAttachment(config) {
    const {
      attachments,
      prompt,
      fileDropSelector,
      chatInputSelector,
      attachmentMethod,
    } = config;

    try {
      const dropTarget = await waitForElement(fileDropSelector);

      // Attach each file in order. Wait between attachments so the target
      // AI page can process the upload before we push the next one.
      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        const file = base64ToFile(a.data, a.name, a.mimeType);
        await attachFile(file, dropTarget, attachmentMethod);
        if (i < attachments.length - 1) {
          await delay(1500);
        }
      }

      // Wait for the last file to be processed, then type the prompt
      await delay(1000);
      const inputTarget = await waitForElement(chatInputSelector);
      await typePrompt(inputTarget, prompt);

      // Optionally click the submit button once upload is complete
      if (config.autoSubmit && config.submitButtonSelector) {
        const submitBtn = await waitForEnabledElement(config.submitButtonSelector);
        submitBtn.click();
      }
    } catch (err) {
      console.error("Page to AI: attachment failed", err);
    }
  }

  function base64ToFile(b64, name, mimeType) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, {
      type: mimeType || "application/octet-stream",
      lastModified: Date.now(),
    });
  }

  async function attachFile(file, target, method) {
    target.focus();

    switch (method) {
      case "paste":
        attachViaPaste(file, target);
        break;
      case "drop":
        attachViaDrop(file, target);
        break;
      case "file-input":
        attachViaFileInput(file, target);
        break;
      default:
        attachViaPaste(file, target);
    }
  }

  function attachViaPaste(file, target) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    target.dispatchEvent(pasteEvent);
  }

  function attachViaDrop(file, target) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const eventInit = { bubbles: true, cancelable: true, dataTransfer };

    target.dispatchEvent(new DragEvent("dragenter", eventInit));
    target.dispatchEvent(new DragEvent("dragover", eventInit));
    target.dispatchEvent(new DragEvent("drop", eventInit));
  }

  function attachViaFileInput(file, target) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    target.files = dataTransfer.files;
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function typePrompt(target, promptText) {
    target.focus();

    // For contenteditable elements (ProseMirror, etc.)
    if (target.isContentEditable) {
      document.execCommand("insertText", false, promptText);
    } else {
      // For regular input/textarea elements
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        target.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      ).set;
      nativeInputValueSetter.call(target, promptText);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function waitForEnabledElement(selector, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      function check() {
        const el = document.querySelector(selector);
        if (el && !el.disabled && el.getAttribute("aria-disabled") !== "true") {
          return resolve(el);
        }
        if (Date.now() - startTime > timeout) {
          return reject(new Error(`Element "${selector}" not enabled within ${timeout}ms`));
        }
        setTimeout(check, 300);
      }

      check();
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
