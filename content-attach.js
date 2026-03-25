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
      content,
      filename,
      prompt,
      fileDropSelector,
      chatInputSelector,
      fileFormat,
      attachmentMethod,
    } = config;

    const mimeTypes = { html: "text/html", markdown: "text/markdown" };
    const mimeType = mimeTypes[fileFormat] || "text/plain";
    const file = new File([content], filename, {
      type: mimeType,
      lastModified: Date.now(),
    });

    try {
      // Step 1: Attach the file
      const dropTarget = await waitForElement(fileDropSelector);
      await attachFile(file, dropTarget, attachmentMethod);

      // Step 2: Wait for the file to be processed, then type the prompt
      await delay(1000);
      const inputTarget = await waitForElement(chatInputSelector);
      await typePrompt(inputTarget, prompt);

      // Step 3: Optionally click the submit button once upload is complete
      if (config.autoSubmit && config.submitButtonSelector) {
        const submitBtn = await waitForEnabledElement(config.submitButtonSelector);
        submitBtn.click();
      }
    } catch (err) {
      console.error("Page to AI: attachment failed", err);
    }
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
