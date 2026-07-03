// Markdown 解析器：把草稿内容转为统一语义块，供模板渲染器和分页器使用。
// 关联模块：paginator.js 根据这些 blocks 生成固定尺寸页面。

(function () {
  function parseFrontmatter(markdown) {
    const result = { data: {}, body: markdown };
    if (!markdown.startsWith("---")) return result;

    const end = markdown.indexOf("\n---", 3);
    if (end === -1) return result;

    const raw = markdown.slice(3, end).trim();
    const data = {};
    raw.split(/\r?\n/).forEach(line => {
      const match = line.match(/^([^:：]+)[:：]\s*(.*)$/);
      if (match) data[match[1].trim()] = match[2].trim();
    });

    return {
      data,
      body: markdown.slice(end + 4).replace(/^\s+/, "")
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inlineMarkdown(value) {
    return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<span class="inline-strong">$1</span>');
  }

  function splitTitle(value) {
    if (value.includes("|")) {
      const parts = value.split("|").map(part => part.trim()).filter(Boolean);
      return {
        black: parts[0] || value,
        gold: parts.slice(1).join(""),
        lines: parts.map(part => inlineMarkdown(part))
      };
    }

    const clean = value.trim();
    if (clean.length <= 12) return { black: clean, gold: "", lines: [inlineMarkdown(clean)] };

    const preferred = ["的", "和", "与", "：", ":"];
    for (const mark of preferred) {
      const index = clean.indexOf(mark, Math.floor(clean.length * 0.45));
      if (index > 0 && index < clean.length - 1) {
        const black = clean.slice(0, index + (mark === "的" ? 0 : 1)).trim();
        const gold = clean.slice(index + (mark === "的" ? 0 : 1)).trim();
        return { black, gold, lines: [inlineMarkdown(black), inlineMarkdown(gold)] };
      }
    }

    const splitAt = Math.ceil(clean.length / 2);
    return {
      black: clean.slice(0, splitAt).trim(),
      gold: clean.slice(splitAt).trim(),
      lines: [inlineMarkdown(clean.slice(0, splitAt).trim()), inlineMarkdown(clean.slice(splitAt).trim())]
    };
  }

  function headingLines(value) {
    return value.split("|").map(part => part.trim()).filter(Boolean).map(part => inlineMarkdown(part));
  }

  function coverTitleLines(value) {
    const clean = value.trim();
    if (!clean) return [];

    if (clean.includes("|")) {
      return clean.split("|")
        .map(part => part.trim())
        .filter(Boolean)
        .map(text => ({ segments: [{ text, tone: "ink" }] }));
    }

    const marked = [];
    let rest = clean;
    const markPattern = /\[\[([^\]]+)\]\]/;
    while (markPattern.test(rest)) {
      const match = rest.match(markPattern);
      const before = rest.slice(0, match.index).trim();
      if (before) marked.push({ text: before, tone: "ink" });
      marked.push({ text: match[1].trim(), tone: "gold" });
      rest = rest.slice(match.index + match[0].length).trim();
    }
    if (rest) marked.push({ text: rest, tone: "ink" });
    if (marked.length > 1) return [{ segments: marked }];

    const chunks = [];
    let cursor = 0;
    const sizes = [4, 7, 4, 6, 5];
    sizes.forEach((size, index) => {
      if (cursor >= clean.length) return;
      const text = clean.slice(cursor, cursor + size).trim();
      if (text) chunks.push({ segments: [{ text, tone: "ink" }] });
      cursor += size;
    });
    if (cursor < clean.length) chunks.push({ segments: [{ text: clean.slice(cursor).trim(), tone: "ink" }] });
    return chunks;
  }

  function pushParagraph(blocks, lines) {
    const text = lines.join("\n").trim();
    if (!text) return;

    const strongMatch = text.match(/^\*\*([\s\S]+)\*\*$/);
    if (strongMatch) {
      blocks.push({ type: "strongBlock", html: inlineMarkdown(strongMatch[1].trim()) });
      return;
    }

    splitLongParagraph(text).forEach(part => {
      blocks.push({ type: "paragraph", text: part, html: inlineMarkdown(part) });
    });
  }

  function pushQuote(blocks, lines) {
    const quoteLines = lines.slice();
    while (quoteLines.length && !quoteLines[0]) quoteLines.shift();
    while (quoteLines.length && !quoteLines[quoteLines.length - 1]) quoteLines.pop();
    if (!quoteLines.length) return;

    // 连续的 > 行属于同一个金句框，> 空行在框内保留为段落间隔。
    const html = quoteLines.map(line => {
      if (!line) return '<div class="xhs-quote-spacer"></div>';
      return `<div class="xhs-quote-line">${inlineMarkdown(line)}</div>`;
    }).join("");

    blocks.push({ type: "quote", html });
  }

  function splitLongParagraph(text) {
    if (text.length <= 90) return [text];
    const sentences = text.split(/(?<=[。！？!?])\s*/).filter(Boolean);
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
    return parts.length ? parts : [text];
  }

  function parseMarkdown(markdown, options) {
    const parsed = parseFrontmatter(markdown);
    const lines = parsed.body.split(/\r?\n/);
    const blocks = [];
    let paragraphLines = [];
    let quoteLines = [];
    let activeList = null;
    let articleTitle = "";
    let hasCoverTitle = false;

    function flushParagraph() {
      pushParagraph(blocks, paragraphLines);
      paragraphLines = [];
    }

    function flushQuote() {
      pushQuote(blocks, quoteLines);
      quoteLines = [];
    }

    function flushList() {
      if (activeList && activeList.items.length) blocks.push(activeList);
      activeList = null;
    }

    lines.forEach(line => {
      const trimmed = line.trim();
      const quote = trimmed.match(/^>\s*(.*)$/);

      if (quote) {
        flushParagraph();
        flushList();
        quoteLines.push(quote[1].trim());
        return;
      }

      if (!trimmed) {
        flushQuote();
        flushParagraph();
        flushList();
        return;
      }

      if (/^---+$/.test(trimmed)) {
        flushQuote();
        flushParagraph();
        flushList();
        blocks.push({ type: "pageBreak" });
        return;
      }

      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushQuote();
        flushParagraph();
        flushList();
        const level = heading[1].length;
        const text = heading[2].trim();
        if (level === 1) {
          if (!articleTitle) articleTitle = text;
          if (!hasCoverTitle) {
            blocks.push({
              type: "coverTitle",
              eyebrow: options.eyebrow || "DENSE READING",
              raw: text,
              lines: coverTitleLines(text)
            });
            hasCoverTitle = true;
          }
          return;
        }
        if (level === 2) {
          blocks.push({ type: "h1", ...splitTitle(text), eyebrow: options.eyebrow });
          return;
        }
        if (level === 3) {
          blocks.push({ type: "h2", html: inlineMarkdown(text), lines: headingLines(text) });
          return;
        }
        blocks.push({ type: "h3", html: inlineMarkdown(text), lines: headingLines(text) });
        return;
      }

      const unordered = trimmed.match(/^[-*]\s+(.+)$/);
      if (unordered) {
        flushQuote();
        flushParagraph();
        if (!activeList || activeList.type !== "ul") {
          flushList();
          activeList = { type: "ul", items: [] };
        }
        activeList.items.push(inlineMarkdown(unordered[1]));
        return;
      }

      const ordered = trimmed.match(/^(\d+)[.、]\s+(.+)$/);
      if (ordered) {
        flushQuote();
        flushParagraph();
        if (!activeList || activeList.type !== "ol") {
          flushList();
          activeList = { type: "ol", items: [] };
        }
        activeList.items.push(inlineMarkdown(ordered[2]));
        return;
      }

      flushQuote();
      flushList();
      paragraphLines.push(trimmed);
    });

    flushQuote();
    flushParagraph();
    flushList();

    if (!hasCoverTitle && parsed.data["封面标题"]) {
      blocks.unshift({
        type: "coverTitle",
        eyebrow: options.eyebrow || "DENSE READING",
        raw: parsed.data["封面标题"],
        lines: coverTitleLines(parsed.data["封面标题"])
      });
    }

    return {
      frontmatter: parsed.data,
      title: parsed.data["正文标题"] || parsed.data["封面标题"] || articleTitle,
      blocks
    };
  }

  window.XhsMarkdownParser = {
    parseMarkdown,
    coverTitleLines,
    inlineMarkdown,
    escapeHtml
  };
})();
