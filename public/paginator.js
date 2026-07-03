// 通用分页器：按模板配置和模板渲染器，把统一语义块分配到固定尺寸页面。
// 关联模块：markdown-parser.js 输出 blocks，templates/*/renderer.js 输出页面和块 DOM。

(function () {
  function splitListBlock(block) {
    return block.items.map((item, index) => ({
      type: block.type,
      items: [item],
      start: index + 1
    }));
  }

  function splitParagraphBlock(block) {
    if (!block.text || block.text.length <= 90) return [block];
    const sentences = block.text.split(/(?<=[。！？!?])\s*/).filter(Boolean);
    const parts = [];
    let current = "";

    sentences.forEach(sentence => {
      if ((current + sentence).length > 90 && current) {
        parts.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
    });

    if (current) parts.push(current);
    return parts.map(text => ({
      type: "paragraph",
      text,
      html: XhsMarkdownParser.inlineMarkdown(text)
    }));
  }

  function expandBlocks(blocks, template) {
    const splittable = new Set(template.pagination?.splittableBlocks || []);
    const expanded = [];

    blocks.forEach(block => {
      if ((block.type === "ul" || block.type === "ol") && splittable.has(block.type)) {
        splitListBlock(block).forEach(itemBlock => expanded.push(itemBlock));
        return;
      }

      if (block.type === "paragraph" && splittable.has("paragraph")) {
        splitParagraphBlock(block).forEach(part => expanded.push(part));
        return;
      }

      expanded.push(block);
    });

    return expanded;
  }

  function orderedStartFor(pages, pageIndex) {
    let start = 1;
    pages.slice(0, pageIndex).flat().forEach(block => {
      if (block.type === "ol") start += block.items.length;
    });
    return start;
  }

  function renderBlocksToContent(content, blocks, renderer, context) {
    let orderedStart = context.orderedStart || 1;
    blocks.forEach(block => {
      if (block.type === "ol") {
        content.appendChild(renderer.renderBlock(block, { ...context, orderedStart }));
        orderedStart += block.items.length;
        return;
      }
      content.appendChild(renderer.renderBlock(block, { ...context, orderedStart: block.start || 1 }));
    });
  }

  function paginate(blocks, options) {
    const measureRoot = options.measureRoot;
    const renderer = options.renderer;
    const template = options.template;
    const account = options.account || "AUTHOR";
    const eyebrow = options.eyebrow || "NOTES";
    const startPage = Number(options.startPage || 1);
    const maxHeight = Number(template.content?.maxHeight || 1070);
    const forceBreakType = template.pagination?.forceBreakType || "pageBreak";
    const avoidOrphanHeadings = Boolean(template.pagination?.avoidOrphanHeadings);
    const expanded = expandBlocks(blocks, template);
    const pages = [];
    let currentBlocks = [];

    function measure(candidateBlocks) {
      measureRoot.innerHTML = "";
      const page = renderer.createPageShell({ account, pageNo: 1, totalPages: 1 });
      const content = page.querySelector(".xhs-content");
      renderBlocksToContent(content, candidateBlocks, renderer, { eyebrow, orderedStart: 1 });
      measureRoot.appendChild(page);
      return content.scrollHeight;
    }

    function previousIsLonelyHeading(candidateBlocks) {
      if (!avoidOrphanHeadings || candidateBlocks.length < 2) return false;
      const previous = candidateBlocks[candidateBlocks.length - 2];
      const current = candidateBlocks[candidateBlocks.length - 1];
      return (previous.type === "h2" || previous.type === "h3") && current.type !== forceBreakType;
    }

    expanded.forEach(block => {
      if (block.type === forceBreakType) {
        if (currentBlocks.length) pages.push(currentBlocks);
        currentBlocks = [];
        return;
      }

      const candidate = currentBlocks.concat(block);
      const height = measure(candidate);

      if (height > maxHeight && currentBlocks.length) {
        if (previousIsLonelyHeading(candidate) && currentBlocks.length > 1) {
          const heading = currentBlocks.pop();
          pages.push(currentBlocks);
          currentBlocks = [heading, block];
        } else {
          pages.push(currentBlocks);
          currentBlocks = [block];
        }
        return;
      }

      currentBlocks = candidate;
    });

    if (currentBlocks.length) pages.push(currentBlocks);

    const renderedPages = pages.map((pageBlocks, index) => {
      const page = renderer.createPageShell({
        account,
        pageNo: startPage + index,
        totalPages: pages.length
      });
      const content = page.querySelector(".xhs-content");
      renderBlocksToContent(content, pageBlocks, renderer, {
        eyebrow,
        orderedStart: orderedStartFor(pages, index)
      });
      return page;
    });

    measureRoot.innerHTML = "";
    return renderedPages;
  }

  window.XhsPaginator = {
    paginate
  };
})();
