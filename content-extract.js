(() => {
  // __pageToAiExtractionMode is set by background.js before this script runs
  const extractionMode = (typeof __pageToAiExtractionMode !== "undefined")
    ? __pageToAiExtractionMode
    : "full";

  let title = document.title || "Untitled";
  let url = window.location.href;
  let content = "";

  if (extractionMode === "smart") {
    try {
      const clone = document.cloneNode(true);
      const article = new Readability(clone).parse();
      if (article && article.content && article.content.trim().length > 100) {
        title = article.title || title;
        content = htmlToMarkdown(article.content);
      }
    } catch (e) {
      // Readability failed, fall through to fallback
    }
  }

  if (!content) {
    // Full page: clone body, strip non-content elements, keep as cleaned HTML
    const clone = document.body.cloneNode(true);
    stripElements(clone, "script, style, noscript, svg, iframe, link, meta");
    content = clone.innerHTML;
  }

  const timestamp = new Date().toISOString();
  return `# ${title}\n\nSource: ${url}\nExtracted: ${timestamp}\n\n${content}`;

  // --- Helpers ---

  function stripElements(container, selector) {
    container.querySelectorAll(selector).forEach((el) => el.remove());
  }

  function htmlToMarkdown(html) {
    const div = document.createElement("div");
    div.innerHTML = html;

    let md = "";

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        md += node.textContent;
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      // Skip hidden elements
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "svg") return;

      switch (tag) {
        case "h1":
          md += "\n\n# ";
          walkChildren(node);
          md += "\n";
          return;
        case "h2":
          md += "\n\n## ";
          walkChildren(node);
          md += "\n";
          return;
        case "h3":
          md += "\n\n### ";
          walkChildren(node);
          md += "\n";
          return;
        case "h4":
        case "h5":
        case "h6":
          md += "\n\n#### ";
          walkChildren(node);
          md += "\n";
          return;
        case "p":
        case "div":
        case "section":
        case "article":
        case "main":
        case "header":
        case "footer":
          md += "\n\n";
          walkChildren(node);
          md += "\n";
          return;
        case "br":
          md += "\n";
          return;
        case "hr":
          md += "\n\n---\n\n";
          return;
        case "strong":
        case "b":
          md += "**";
          walkChildren(node);
          md += "**";
          return;
        case "em":
        case "i":
          md += "*";
          walkChildren(node);
          md += "*";
          return;
        case "a": {
          const href = node.getAttribute("href");
          if (href && !href.startsWith("javascript:")) {
            md += "[";
            walkChildren(node);
            md += "](" + href + ")";
          } else {
            walkChildren(node);
          }
          return;
        }
        case "ul":
          md += "\n";
          for (const li of node.children) {
            if (li.tagName && li.tagName.toLowerCase() === "li") {
              md += "\n- ";
              walkChildren(li);
            }
          }
          md += "\n";
          return;
        case "ol": {
          md += "\n";
          let i = 1;
          for (const li of node.children) {
            if (li.tagName && li.tagName.toLowerCase() === "li") {
              md += "\n" + i + ". ";
              walkChildren(li);
              i++;
            }
          }
          md += "\n";
          return;
        }
        case "table":
          md += "\n\n";
          md += tableToMarkdown(node);
          md += "\n";
          return;
        case "code":
          md += "`";
          walkChildren(node);
          md += "`";
          return;
        case "pre":
          md += "\n\n```\n";
          md += node.textContent;
          md += "\n```\n";
          return;
        case "blockquote":
          md += "\n\n> ";
          walkChildren(node);
          md += "\n";
          return;
        case "img": {
          const alt = node.getAttribute("alt") || "";
          const src = node.getAttribute("src") || "";
          if (src) md += `![${alt}](${src})`;
          return;
        }
        default:
          walkChildren(node);
      }
    }

    function walkChildren(node) {
      for (const child of node.childNodes) {
        walk(child);
      }
    }

    function tableToMarkdown(table) {
      const rows = [];
      for (const tr of table.querySelectorAll("tr")) {
        const cells = [];
        for (const cell of tr.querySelectorAll("th, td")) {
          cells.push(cell.textContent.trim().replace(/\|/g, "\\|"));
        }
        rows.push(cells);
      }

      if (rows.length === 0) return "";

      let result = "";
      // Header row
      result += "| " + rows[0].join(" | ") + " |\n";
      result += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
      // Data rows
      for (let i = 1; i < rows.length; i++) {
        // Pad to match header column count
        while (rows[i].length < rows[0].length) rows[i].push("");
        result += "| " + rows[i].join(" | ") + " |\n";
      }
      return result;
    }

    walkChildren(div);

    // Clean up excessive whitespace
    return md
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
})();
