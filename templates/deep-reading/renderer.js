// Deep Reading 模板渲染器：把统一语义块转换为本模板 HTML 节点。
// 关联模块：template.json 定义分页规则，components.css 定义这些节点的视觉样式。

(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function createPageShell(options) {
    const page = document.createElement("section");
    page.className = "xhs-page";
    page.innerHTML = `
      <div class="xhs-border"></div>
      <div class="xhs-content"></div>
      <footer class="xhs-footer">
        <div class="xhs-footer-line"></div>
        <div class="xhs-footer-row">
          <span>${escapeHtml(options.account)}</span>
          <span class="xhs-page-no">${String(options.pageNo).padStart(2, "0")} / ${String(options.totalPages).padStart(2, "0")}</span>
        </div>
      </footer>
    `;
    return page;
  }

  function renderBlock(block, context) {
    const wrapper = document.createElement("div");

    function renderHeadingLines(lines, className) {
      return (lines || []).map(line => `<div class="${className}">${line}</div>`).join("");
    }

    if (block.type === "coverTitle") {
      wrapper.className = "block-cover-title";
      const titleLines = block.lines || (block.segments || []).map(segment => ({ segments: [segment] }));
      const lines = titleLines.map(line => {
        const segments = (line.segments || []).map(segment => {
          const tone = segment.tone === "gold" ? " gold" : "";
          return `<span class="xhs-cover-title-part${tone}">${escapeHtml(segment.text)}</span>`;
        }).join("");
        return `<div class="xhs-cover-title-line">${segments}</div>`;
      }).join("");
      wrapper.innerHTML = `
        <div class="xhs-cover-title-lines">${lines}</div>
      `;
      return wrapper;
    }

    if (block.type === "h1") {
      wrapper.className = "block-h1";
      wrapper.innerHTML = `
        <p class="xhs-eyebrow">${escapeHtml(block.eyebrow || context.eyebrow || "NOTES")}</p>
        <div class="xhs-title-lines">
          ${block.lines ? renderHeadingLines(block.lines, "xhs-title-line") : `<h1 class="xhs-title-line">${escapeHtml(block.black)}</h1>${block.gold ? `<h1 class="xhs-title-line gold">${escapeHtml(block.gold)}</h1>` : ""}`}
        </div>
      `;
      return wrapper;
    }

    if (block.type === "h2") {
      wrapper.className = "block-h2";
      wrapper.innerHTML = `<h2>${block.lines ? renderHeadingLines(block.lines, "xhs-subtitle-line") : block.html}</h2><div class="xhs-rule"></div>`;
      return wrapper;
    }

    if (block.type === "h3") {
      wrapper.className = "block-h3";
      wrapper.innerHTML = `<h3>${block.lines ? renderHeadingLines(block.lines, "xhs-subtitle-line") : block.html}</h3><div class="xhs-rule"></div>`;
      return wrapper;
    }

    if (block.type === "paragraph") {
      wrapper.className = "block-paragraph";
      wrapper.innerHTML = block.html;
      return wrapper;
    }

    if (block.type === "strongBlock") {
      wrapper.className = "block-strong";
      wrapper.innerHTML = block.html;
      return wrapper;
    }

    if (block.type === "quote") {
      wrapper.className = "block-quote";
      wrapper.innerHTML = `<div class="xhs-quote-box">${block.html}</div>`;
      return wrapper;
    }

    if (block.type === "ul" || block.type === "ol") {
      wrapper.className = "block-list";
      wrapper.dataset.listType = block.type;
      wrapper.innerHTML = block.items.map((item, index) => {
        const marker = block.type === "ol" ? `${context.orderedStart + index}.` : "·";
        const rowClass = block.type === "ol" ? "ordered" : "unordered";
        return `
          <div class="xhs-list-row ${rowClass}">
            <span class="xhs-list-marker">${marker}</span>
            <span class="xhs-list-text">${item}</span>
          </div>
        `;
      }).join("");
      return wrapper;
    }

    wrapper.className = "force-break";
    return wrapper;
  }

  window.XhsTemplateRenderer = {
    id: "deep-reading",
    createPageShell,
    renderBlock
  };
})();
