// 工具主逻辑：草稿选择、Markdown 渲染预览、导出 HTML/PNG。
// 关联模块：server.js API、markdown-parser.js、paginator.js。

(function () {
  const els = {
    templateSelect: document.getElementById("templateSelect"),
    presetSelect: document.getElementById("presetSelect"),
    currentFileInput: document.getElementById("currentFileInput"),
    markdownInput: document.getElementById("markdownInput"),
    refreshDraftButton: document.getElementById("refreshDraftButton"),
    localMdButton: document.getElementById("localMdButton"),
    localMdInput: document.getElementById("localMdInput"),
    accountInput: document.getElementById("accountInput"),
    eyebrowInput: document.getElementById("eyebrowInput"),
    coverHighlightInput: document.getElementById("coverHighlightInput"),
    coverLinesEditor: document.getElementById("coverLinesEditor"),
    coverStyleEditor: document.getElementById("coverStyleEditor"),
    globalStyleEditor: document.getElementById("globalStyleEditor"),
    elementSelect: document.getElementById("elementSelect"),
    templateEditor: document.getElementById("templateEditor"),
    saveTemplateButton: document.getElementById("saveTemplateButton"),
    savePresetAsButton: document.getElementById("savePresetAsButton"),
    saveCoverLayoutButton: document.getElementById("saveCoverLayoutButton"),
    resetTemplateButton: document.getElementById("resetTemplateButton"),
    editorStatusText: document.getElementById("editorStatusText"),
    exportButton: document.getElementById("exportButton"),
    exportHistory: document.getElementById("exportHistory"),
    previewRoot: document.getElementById("previewRoot"),
    measureRoot: document.getElementById("measureRoot"),
    statusText: document.getElementById("statusText"),
    pageCountText: document.getElementById("pageCountText"),
    previewZoomInput: document.getElementById("previewZoomInput"),
    previewZoomText: document.getElementById("previewZoomText")
  };

  let currentFileName = "";
  let templates = [];
  let activeTemplate = null;
  let visualSettings = { variables: {}, config: {} };
  let coverTitleState = { lines: [], highlights: "" };
  let renderTimer = null;
  let autoReloadTimer = null;
  let currentSourceMode = "draft";
  let localFileHandle = null;
  let localFileUpdatedAt = 0;
  let localFilePollTimer = null;
  const LAST_EXPORT_FOLDER_KEY = "xhsMdLastExportFolder";
  const EXPORT_HANDLE_DB_NAME = "xhs-md-layout-tool";
  const EXPORT_HANDLE_STORE = "handles";
  const EXPORT_DIRECTORY_HANDLE_KEY = "lastExportDirectory";
  const ELEMENT_EDITOR_OPTIONS = [
    { id: "h1", label: "H1" },
    { id: "h2", label: "H2" },
    { id: "h3", label: "H3" },
    { id: "paragraph", label: "正文" },
    { id: "list", label: "列表" },
    { id: "quote", label: "金句" },
    { id: "border", label: "边框" },
    { id: "footer", label: "页脚" },
    { id: "account", label: "页面账号" },
    { id: "eyebrow", label: "栏目标签" }
  ];
  let previewZoom = 1;
  let activeElementEditorId = "h1";

  function setStatus(message) {
    els.statusText.textContent = message;
  }

  function setCurrentFileName(fileName) {
    currentFileName = fileName || "";
    els.currentFileInput.value = currentFileName || "未选择 Markdown 文件";
  }

  function applyPreviewZoom(value) {
    previewZoom = Math.max(0.4, Math.min(1.5, Number(value) || 1));
    document.body.style.setProperty("--preview-zoom", String(previewZoom));
    if (els.previewZoomInput) els.previewZoomInput.value = String(Math.round(previewZoom * 100));
    if (els.previewZoomText) els.previewZoomText.textContent = `${Math.round(previewZoom * 100)}%`;
  }

  function setEditorStatus(message, type) {
    els.editorStatusText.textContent = message;
    els.editorStatusText.className = `editor-status-text ${type || ""}`.trim();
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "请求失败");
    }
    return data;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function mergeDeep(base, patch) {
    const result = clone(base);
    Object.entries(patch || {}).forEach(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        result[key] = mergeDeep(result[key] || {}, value);
        return;
      }
      result[key] = value;
    });
    return result;
  }

  function getByPath(source, path) {
    return path.split(".").reduce((current, key) => current?.[key], source);
  }

  function setByPath(target, path, value) {
    const keys = path.split(".");
    let current = target;
    keys.slice(0, -1).forEach(key => {
      if (!current[key] || typeof current[key] !== "object") current[key] = {};
      current = current[key];
    });
    current[keys[keys.length - 1]] = value;
  }

  function cssValue(control, rawValue) {
    if (control.type === "number") return `${rawValue}${control.unit || ""}`;
    return rawValue;
  }

  function buildOverrideCss() {
    const rows = Object.entries(visualSettings.variables || {})
      .filter(([, value]) => value)
      .map(([name, value]) => `  ${name}: ${value};`);
    return rows.length ? `:root {\n${rows.join("\n")}\n}` : "";
  }

  function applyVisualSettings() {
    let style = document.getElementById("xhs-visual-overrides");
    if (!style) {
      style = document.createElement("style");
      style.id = "xhs-visual-overrides";
      document.head.appendChild(style);
    }
    style.textContent = buildOverrideCss();
  }

  function settingsFromPreset(preset) {
    return {
      variables: clone(preset?.variables || {}),
      config: clone(preset?.config || {})
    };
  }

  function currentPreset() {
    return activeTemplate?.presets?.find(preset => preset.id === activeTemplate.currentPresetId)
      || activeTemplate?.presets?.[0]
      || { id: "default", name: "默认样式", variables: {}, config: {} };
  }

  function renderPresetSelect() {
    const presets = activeTemplate?.presets || [];
    els.presetSelect.innerHTML = presets.map(preset => {
      return `<option value="${XhsMarkdownParser.escapeHtml(preset.id)}">${XhsMarkdownParser.escapeHtml(preset.name)}</option>`;
    }).join("");
    els.presetSelect.value = activeTemplate.currentPresetId || presets[0]?.id || "default";
  }

  function applyPreset(presetId) {
    const preset = activeTemplate.presets.find(item => item.id === presetId) || currentPreset();
    activeTemplate.currentPresetId = preset.id;
    visualSettings = settingsFromPreset(preset);
    activeTemplate.config = mergeDeep(activeTemplate.baseConfig, visualSettings.config);
    applyVisualSettings();
    renderPresetSelect();
    renderTemplateEditor();
    renderCoverStyleEditor();
  }

  function upsertPreset(preset) {
    const presets = activeTemplate.presets || [];
    const index = presets.findIndex(item => item.id === preset.id);
    if (index >= 0) presets[index] = preset;
    else presets.push(preset);
    activeTemplate.presets = presets;
    activeTemplate.currentPresetId = preset.id;

    const cachedTemplate = templates.find(item => item.id === activeTemplate.id);
    if (cachedTemplate) {
      cachedTemplate.presets = clone(activeTemplate.presets);
      cachedTemplate.currentPresetId = preset.id;
      cachedTemplate.settings = settingsFromPreset(preset);
      cachedTemplate.config = clone(activeTemplate.config);
    }
  }

  function parseHighlightTerms(value) {
    return String(value || "")
      .split(/[,，、;；]+/)
      .map(term => term.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
  }

  function highlightLine(text, terms) {
    let rest = String(text || "");
    const segments = [];

    while (rest) {
      const match = terms
        .map(term => ({ term, index: rest.indexOf(term) }))
        .filter(item => item.index >= 0)
        .sort((a, b) => a.index - b.index || b.term.length - a.term.length)[0];

      if (!match) {
        segments.push({ text: rest, tone: "ink" });
        break;
      }

      if (match.index > 0) {
        segments.push({ text: rest.slice(0, match.index), tone: "ink" });
      }
      segments.push({ text: match.term, tone: "gold" });
      rest = rest.slice(match.index + match.term.length);
    }

    return segments.filter(segment => segment.text);
  }

  function coverBlockFromState(originalBlock) {
    const terms = parseHighlightTerms(coverTitleState.highlights);
    return {
      ...originalBlock,
      lines: coverTitleState.lines
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => ({ segments: highlightLine(line, terms) }))
    };
  }

  function applyCoverEditor(blocks) {
    return blocks.map(block => {
      if (block.type !== "coverTitle") return block;
      return coverBlockFromState(block);
    });
  }

  function syncCoverEditor(parsed, override) {
    const coverBlock = parsed.blocks.find(block => block.type === "coverTitle");
    if (!coverBlock) {
      coverTitleState = { lines: [], highlights: "" };
      els.coverHighlightInput.value = "";
      els.coverLinesEditor.innerHTML = '<p class="status-text">当前文档没有一级标题 #。</p>';
      return;
    }

    const savedCoverTitle = override?.coverTitle || {};
    const markdownLines = (coverBlock.lines || []).map(line => (line.segments || []).map(segment => segment.text).join(""));
    coverTitleState = {
      lines: savedCoverTitle.lines?.length ? savedCoverTitle.lines : markdownLines,
      highlights: savedCoverTitle.highlights || ""
    };
    els.coverHighlightInput.value = coverTitleState.highlights;
    renderCoverLineEditor();
  }

  function renderCoverLineEditor() {
    els.coverLinesEditor.innerHTML = coverTitleState.lines.map((line, index) => {
      return `
        <label class="text-element-control cover-line-row">
          <span class="property-label">标题行 ${index + 1}</span>
          <input type="text" value="${XhsMarkdownParser.escapeHtml(line)}" data-cover-line="${index}">
        </label>
      `;
    }).join("");
  }

  function renderControl(control, groupIndex, controlIndex, source) {
    const id = `${source}-${groupIndex}-${controlIndex}`;
    const value = getControlValue(control);
    const inputValue = control.type === "color" && !String(value).startsWith("#")
      ? control.default
      : String(value).replace(control.unit || "", "");
    if (control.type === "color") {
      return renderColorControl(control, groupIndex, controlIndex, source, inputValue);
    }
    return renderNumberControl(control, groupIndex, controlIndex, source, inputValue);
  }

  function numberInputAttrs(control) {
    if (control.type !== "number") return "";
    const bounds = expandedNumberBounds(control);
    return `min="${bounds.min}" max="${bounds.max}" step="${bounds.step}"`;
  }

  function expandedNumberBounds(control) {
    const step = Number(control.step || 1);
    const min = Number(control.min);
    const max = Number(control.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: control.min, max: control.max, step };
    }

    const span = Math.max(step, max - min);
    const rawPadding = Math.max(step * 4, span * 0.15);
    const padding = Math.max(step, Math.round(rawPadding / step) * step);
    const nextMin = min >= 0 ? Math.max(0, min - padding) : min - padding;
    return {
      min: nextMin,
      max: max + padding,
      step
    };
  }

  function renderNumberStepper() {
    return `
      <span class="number-stepper" aria-hidden="true">
        <button type="button" class="number-stepper-button number-stepper-up" data-stepper-action="up" tabindex="-1"></button>
        <button type="button" class="number-stepper-button number-stepper-down" data-stepper-action="down" tabindex="-1"></button>
      </span>
    `;
  }

  function renderNumberControl(control, groupIndex, controlIndex, source, inputValue, prefix = "") {
    const id = `${source}-${groupIndex}-${controlIndex}`;
    return `
      <div class="editor-control editor-control-number">
        <div class="editor-control-meta">
          <label for="${id}">${XhsMarkdownParser.escapeHtml(control.label)}</label>
          <span class="editor-value">${XhsMarkdownParser.escapeHtml(inputValue)}${control.unit || ""}</span>
        </div>
        <label class="property-field">
          ${prefix ? `<span class="property-prefix">${XhsMarkdownParser.escapeHtml(prefix)}</span>` : ""}
          <input id="${id}" type="number" ${numberInputAttrs(control)} value="${XhsMarkdownParser.escapeHtml(inputValue)}" data-group="${groupIndex}" data-control="${controlIndex}">
          ${renderNumberStepper()}
        </label>
      </div>
    `;
  }

  function renderCompactNumberControl(ref, source, prefix = "") {
    const control = ref.control;
    const id = `${source}-${ref.groupIndex}-${ref.controlIndex}`;
    const inputValue = String(getControlValue(control)).replace(control.unit || "", "");
    const labelText = prefix || control.label;
    return `
      <label class="compact-control editor-control editor-control-number" title="${XhsMarkdownParser.escapeHtml(control.label)}">
        <span class="property-label">${XhsMarkdownParser.escapeHtml(labelText)}</span>
        <span class="property-field">
          ${["T", "R", "B", "L"].includes(prefix) ? `<span class="property-icon property-icon-${prefix.toLowerCase()}" aria-hidden="true"></span>` : ""}
          ${prefix && !["T", "R", "B", "L"].includes(prefix) ? `<span class="property-prefix">${XhsMarkdownParser.escapeHtml(prefix)}</span>` : ""}
          <input id="${id}" type="number" ${numberInputAttrs(control)} value="${XhsMarkdownParser.escapeHtml(inputValue)}" data-group="${ref.groupIndex}" data-control="${ref.controlIndex}">
          ${renderNumberStepper()}
        </span>
        <span class="editor-value">${XhsMarkdownParser.escapeHtml(inputValue)}${control.unit || ""}</span>
      </label>
    `;
  }

  function renderColorControl(control, groupIndex, controlIndex, source, inputValue) {
    const id = `${source}-${groupIndex}-${controlIndex}`;
    const safeValue = XhsMarkdownParser.escapeHtml(inputValue);
    return `
      <div class="editor-control editor-control-color color-control">
        <label class="color-name" for="${id}">${XhsMarkdownParser.escapeHtml(control.label)}</label>
        <div class="color-button" style="--color-value: ${safeValue};">
          <span class="color-button-main">
            <label class="color-swatch" title="点击选择颜色">
              <input id="${id}-picker" type="color" value="${safeValue}" data-group="${groupIndex}" data-control="${controlIndex}">
            </label>
            <input id="${id}" class="color-hex-input" type="text" value="${safeValue}" maxlength="7" spellcheck="false" data-group="${groupIndex}" data-control="${controlIndex}" aria-label="${XhsMarkdownParser.escapeHtml(control.label)} HEX">
          </span>
          <span class="color-button-separator"></span>
          <span class="color-alpha-text">100%</span>
        </div>
        <span class="editor-value">${safeValue}</span>
      </div>
    `;
  }

  function renderCoverStyleEditor() {
    const groups = activeTemplate.editor?.groups || [];
    const groupIndex = groups.findIndex(group => group.name === "封面标题");
    if (groupIndex < 0) {
      els.coverStyleEditor.innerHTML = "";
      return;
    }

    const group = groups[groupIndex];
    const refs = (group.controls || []).map((control, controlIndex) => {
      return { group, groupIndex, control, controlIndex };
    });
    els.coverStyleEditor.innerHTML = renderControlRefs("标题样式", refs, "cover-style");
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderPreview, 120);
  }

  function getControlValue(control) {
    if (control.target === "cssVar") {
      return visualSettings.variables?.[control.name] || cssValue(control, control.default);
    }

    const savedValue = getByPath(visualSettings.config || {}, control.path);
    if (savedValue !== undefined) return savedValue;
    return getByPath(activeTemplate.config, control.path) ?? control.default;
  }

  function applyControlValue(control, value) {
    if (control.target === "cssVar") {
      visualSettings.variables[control.name] = cssValue(control, value);
      if (control.syncConfigPath) {
        const normalized = control.type === "number" ? Number(value) : value;
        setByPath(visualSettings.config, control.syncConfigPath, normalized);
        setByPath(activeTemplate.config, control.syncConfigPath, normalized);
      }
      applyVisualSettings();
      scheduleRender();
      setEditorStatus("有未保存的模板调整。", "");
      return;
    }

    const normalized = control.type === "number" ? Number(value) : value;
    setByPath(visualSettings.config, control.path, normalized);
    setByPath(activeTemplate.config, control.path, normalized);
    scheduleRender();
    setEditorStatus("有未保存的模板调整。", "");
  }

  function defaultSettingsFromEditor(editor) {
    const defaults = { variables: {}, config: {} };
    (editor?.groups || []).forEach(group => {
      (group.controls || []).forEach(control => {
        if (control.target === "cssVar") {
          defaults.variables[control.name] = cssValue(control, control.default);
          if (control.syncConfigPath) {
            setByPath(defaults.config, control.syncConfigPath, control.default);
          }
          return;
        }
        setByPath(defaults.config, control.path, control.default);
      });
    });
    return defaults;
  }

  function controlKey(control) {
    return control.name || control.path || "";
  }

  function getControlRefs(filter) {
    const groups = activeTemplate.editor?.groups || [];
    const refs = [];
    groups.forEach((group, groupIndex) => {
      (group.controls || []).forEach((control, controlIndex) => {
        if (filter(control, group)) refs.push({ group, groupIndex, control, controlIndex });
      });
    });
    return refs;
  }

  function renderControlRefs(title, refs, source) {
    if (!refs.length) return "";
    const controls = renderStructuredControls(refs, source);

    return `
      <details class="editor-group">
        <summary class="editor-group-title">${XhsMarkdownParser.escapeHtml(title)}</summary>
        <div class="editor-group-body">${controls}</div>
      </details>
    `;
  }

  function refId(ref) {
    return `${ref.groupIndex}-${ref.controlIndex}`;
  }

  function keyWithoutPrefix(control) {
    return controlKey(control).replace(/^--xhs-/, "");
  }

  function renderPropertySection(title, body) {
    if (!body) return "";
    return `
      <div class="property-section">
        ${body}
      </div>
    `;
  }

  function renderDimensionControls(refs, source, used) {
    const rows = [];
    refs.forEach(ref => {
      if (used.has(refId(ref))) return;
      const key = keyWithoutPrefix(ref.control);
      if (!key.endsWith("-width")) return;
      const base = key.slice(0, -"width".length);
      const heightRef = refs.find(item => !used.has(refId(item)) && keyWithoutPrefix(item.control) === `${base}height`);
      if (!heightRef) return;
      used.add(refId(ref));
      used.add(refId(heightRef));
      rows.push(`
        <div class="property-row property-row-2">
          ${renderCompactNumberControl(ref, source, "W")}
          ${renderCompactNumberControl(heightRef, source, "H")}
        </div>
      `);
    });
    return renderPropertySection("Dimensions", rows.join(""));
  }

  function directionalMatch(control) {
    const key = keyWithoutPrefix(control);
    const match = key.match(/^(.+?)(?:-(padding|margin|gap))?-(top|right|bottom|left)$/);
    if (!match) return null;
    return {
      base: `${match[1]}-${match[2] || "position"}`,
      kind: match[2] || "position",
      side: match[3]
    };
  }

  function shouldRenderDirectionalGroup(source, match, group) {
    if (source === "cover-style" && match.kind === "margin") {
      return false;
    }
    return Object.keys(group).length > 0;
  }

  function sideValue(group, side) {
    const ref = group[side];
    if (!ref) return "";
    return String(getControlValue(ref.control)).replace(ref.control.unit || "", "");
  }

  function renderDirectionPill(group, side, source) {
    const ref = group[side];
    if (!ref) return "";
    const control = ref.control;
    const id = `${source}-pill-${ref.groupIndex}-${ref.controlIndex}`;
    const value = sideValue(group, side);
    return `
      <label class="direction-pill direction-pill-${side}" title="${XhsMarkdownParser.escapeHtml(control.label)}">
        <input id="${id}" type="number" ${numberInputAttrs(control)} value="${XhsMarkdownParser.escapeHtml(value)}" data-group="${ref.groupIndex}" data-control="${ref.controlIndex}">
      </label>
    `;
  }

  function renderDirectionalControls(refs, source, used) {
    const sides = ["top", "right", "bottom", "left"];
    const groups = new Map();
    refs.forEach(ref => {
      if (used.has(refId(ref))) return;
      const match = directionalMatch(ref.control);
      if (!match) return;
      if (!groups.has(match.base)) groups.set(match.base, { __match: match });
      groups.get(match.base)[match.side] = ref;
    });

    const blocks = Array.from(groups.values()).map(group => {
      if (!shouldRenderDirectionalGroup(source, group.__match, group)) return "";
      const existing = sides.map(side => group[side]).filter(Boolean);
      if (!existing.length) return "";
      existing.forEach(ref => used.add(refId(ref)));
      return `
        <div class="direction-control">
          <div class="direction-box" aria-hidden="true">
            ${sides.map(side => renderDirectionPill(group, side, source)).join("")}
          </div>
          <div class="direction-input-grid">
          ${sides.map(side => {
            const ref = group[side];
            if (!ref) {
              return `
                <div class="compact-control compact-control-disabled">
                  <span class="property-label">${side[0].toUpperCase()}</span>
                  <div class="property-field property-field-empty"><span class="property-icon property-icon-${side[0]}" aria-hidden="true"></span></div>
                </div>
              `;
            }
            return renderCompactNumberControl(ref, source, side[0].toUpperCase());
          }).join("")}
          </div>
        </div>
      `;
    }).join("");

    return renderPropertySection("Spacing", blocks);
  }

  function isSpacingLikeControl(control) {
    const key = keyWithoutPrefix(control);
    return /gap|margin|padding|left|right|top|bottom|height|line-height|min-height|size|width/.test(key) || control.path;
  }

  function renderSpacingControls(refs, source, used) {
    const rows = refs
      .filter(ref => !used.has(refId(ref)) && ref.control.type !== "color" && isSpacingLikeControl(ref.control))
      .map(ref => {
        used.add(refId(ref));
        return renderCompactNumberControl(ref, source);
      }).join("");
    return renderPropertySection("Values", rows ? `<div class="property-stack">${rows}</div>` : "");
  }

  function renderColorControls(refs, source, used) {
    const rows = refs
      .filter(ref => !used.has(refId(ref)) && ref.control.type === "color")
      .map(ref => {
        used.add(refId(ref));
        return renderControl(ref.control, ref.groupIndex, ref.controlIndex, source);
      }).join("");
    return renderPropertySection("Colors", rows);
  }

  function renderRemainingControls(refs, source, used) {
    return refs
      .filter(ref => !used.has(refId(ref)))
      .map(ref => renderControl(ref.control, ref.groupIndex, ref.controlIndex, source))
      .join("");
  }

  function renderStructuredControls(refs, source) {
    const used = new Set();
    return [
      renderDimensionControls(refs, source, used),
      renderDirectionalControls(refs, source, used),
      renderSpacingControls(refs, source, used),
      renderColorControls(refs, source, used),
      renderRemainingControls(refs, source, used)
    ].join("");
  }

  function isGlobalColorControl(control) {
    return [
      "--xhs-paper",
      "--xhs-text",
      "--xhs-ink",
      "--xhs-gold",
      "--xhs-gold-deep",
      "--xhs-line",
      "--xhs-quote-background"
    ].includes(controlKey(control));
  }

  function isGlobalLayoutControl(control) {
    const key = controlKey(control);
    if (key === "content.maxHeight") return true;
    return key.startsWith("--xhs-content-");
  }

  function isElementControl(elementId, control) {
    const key = controlKey(control);
    if (elementId === "h1") return key.startsWith("--xhs-h1-") || key.startsWith("--xhs-eyebrow-");
    if (elementId === "h2") return key.startsWith("--xhs-h2-") || key.startsWith("--xhs-rule-");
    if (elementId === "h3") return key.startsWith("--xhs-h3-") || key.startsWith("--xhs-rule-");
    if (elementId === "paragraph") return key.startsWith("--xhs-paragraph-") || key.startsWith("--xhs-strong-");
    if (elementId === "list") return key.startsWith("--xhs-list-");
    if (elementId === "quote") return key.startsWith("--xhs-quote-") && key !== "--xhs-quote-background";
    if (elementId === "border") return key.startsWith("--xhs-border-") || key === "--xhs-line";
    if (elementId === "footer") return key.startsWith("--xhs-footer-") || key === "--xhs-page-no-size";
    return false;
  }

  function renderElementSelect() {
    els.elementSelect.innerHTML = ELEMENT_EDITOR_OPTIONS.map(option => {
      return `<option value="${option.id}">${XhsMarkdownParser.escapeHtml(option.label)}</option>`;
    }).join("");
    els.elementSelect.value = activeElementEditorId;
  }

  function textElementValue(elementId) {
    if (elementId === "account") return els.accountInput.value;
    if (elementId === "eyebrow") return els.eyebrowInput.value;
    return "";
  }

  function renderTextElementEditor(option) {
    const value = textElementValue(option.id);
    return `
      <details class="editor-group">
        <summary class="editor-group-title">${XhsMarkdownParser.escapeHtml(option.label)}</summary>
        <div class="editor-group-body">
          <label class="text-element-control">
            <span class="property-label">${XhsMarkdownParser.escapeHtml(option.label)}</span>
            <input type="text" value="${XhsMarkdownParser.escapeHtml(value)}" data-text-element="${option.id}">
          </label>
        </div>
      </details>
    `;
  }

  function renderGlobalStyleEditor() {
    const layoutRefs = getControlRefs(control => isGlobalLayoutControl(control));
    const colorRefs = getControlRefs(control => isGlobalColorControl(control));
    els.globalStyleEditor.innerHTML = [
      renderControlRefs("布局", layoutRefs, "global-layout"),
      renderControlRefs("颜色", colorRefs, "global-color")
    ].join("");
  }

  function renderElementEditor() {
    const option = ELEMENT_EDITOR_OPTIONS.find(item => item.id === activeElementEditorId) || ELEMENT_EDITOR_OPTIONS[0];
    if (option.id === "account" || option.id === "eyebrow") {
      els.templateEditor.innerHTML = renderTextElementEditor(option);
      return;
    }

    const refs = getControlRefs(control => isElementControl(option.id, control));
    els.templateEditor.innerHTML = renderControlRefs(option.label, refs, `element-${option.id}`)
      || '<p class="status-text">这个元素还没有可编辑参数。</p>';
  }

  function renderTemplateEditor() {
    const editor = activeTemplate.editor || { groups: [] };
    if (!editor.groups.length) {
      els.globalStyleEditor.innerHTML = "";
      els.templateEditor.innerHTML = '<p class="status-text">这个模板还没有定义可视化编辑项。</p>';
      return;
    }

    renderElementSelect();
    renderGlobalStyleEditor();
    renderElementEditor();
  }

  function loadStylesheet(id, href) {
    return new Promise((resolve, reject) => {
      let link = document.getElementById(id);
      if (!link) {
        link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }

      if (link.href.endsWith(href)) {
        resolve();
        return;
      }

      link.onload = resolve;
      link.onerror = () => reject(new Error("模板样式加载失败"));
      link.href = href;
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const oldScript = document.getElementById("xhs-template-renderer");
      if (oldScript) oldScript.remove();

      const script = document.createElement("script");
      script.id = "xhs-template-renderer";
      script.src = `${src}?v=${Date.now()}`;
      script.onload = resolve;
      script.onerror = () => reject(new Error("模板渲染器加载失败"));
      document.head.appendChild(script);
    });
  }

  async function loadTemplates() {
    const data = await fetchJson("/api/templates");
    templates = data.templates || [];
    if (!templates.length) throw new Error("没有找到可用模板。");

    els.templateSelect.innerHTML = templates.map(template => {
      return `<option value="${XhsMarkdownParser.escapeHtml(template.id)}">${XhsMarkdownParser.escapeHtml(template.name)}</option>`;
    }).join("");

    const defaultTemplate = templates.find(template => template.default) || templates[0];
    els.templateSelect.value = defaultTemplate.id;
    await loadTemplate(defaultTemplate.id);
  }

  async function loadTemplate(templateId) {
    const template = templates.find(item => item.id === templateId);
    if (!template) throw new Error("模板不存在。");

    activeTemplate = {
      ...template,
      baseConfig: clone(template.baseConfig || template.config),
      config: clone(template.config)
    };
    visualSettings = clone(template.settings || { variables: {}, config: {} });
    activeTemplate.presets = clone(template.presets || []);
    activeTemplate.currentPresetId = template.currentPresetId || activeTemplate.presets[0]?.id || "default";
    await Promise.all([
      loadStylesheet("xhs-template-tokens", template.assets.tokensCss),
      loadStylesheet("xhs-template-components", template.assets.componentsCss)
    ]);
    window.XhsTemplateRenderer = null;
    await loadScript(template.assets.rendererJs);

    if (!window.XhsTemplateRenderer) {
      throw new Error("模板渲染器没有正确注册。");
    }

    applyPreset(activeTemplate.currentPresetId);
    setEditorStatus(`当前样式：${currentPreset().name}。未保存的调整会用于本次预览和导出。`, "");
  }

  async function loadDraft(fileName) {
    stopLocalFilePolling();
    currentSourceMode = "draft";
    setCurrentFileName(fileName);
    const data = await fetchJson(`/api/draft?file=${encodeURIComponent(fileName)}`);
    els.markdownInput.value = data.content;
    const parsed = XhsMarkdownParser.parseMarkdown(els.markdownInput.value, {
      eyebrow: els.eyebrowInput.value.trim() || "NOTES"
    });
    const override = await loadLayoutOverride(fileName);
    syncCoverEditor(parsed, override);
    renderPreview(parsed);
    setStatus(`已同步最新文档：${fileName}`);
  }

  function stopLocalFilePolling() {
    if (localFilePollTimer) {
      window.clearInterval(localFilePollTimer);
      localFilePollTimer = null;
    }
    localFileHandle = null;
    localFileUpdatedAt = 0;
  }

  async function renderMarkdownContent(fileName, content, statusMessage) {
    setCurrentFileName(fileName);
    els.markdownInput.value = content;
    const parsed = XhsMarkdownParser.parseMarkdown(content, {
      eyebrow: els.eyebrowInput.value.trim() || "NOTES"
    });
    const override = await loadLayoutOverride(fileName);
    syncCoverEditor(parsed, override);
    renderPreview(parsed);
    setStatus(statusMessage || `已载入文档：${fileName}`);
  }

  async function loadLocalFile(file, handle) {
    if (!file) return;
    if (!/\.md$/i.test(file.name)) {
      setStatus("请选择 .md 格式的 Markdown 文件。");
      return;
    }

    stopLocalFilePolling();
    currentSourceMode = "local";
    localFileHandle = handle || null;
    localFileUpdatedAt = file.lastModified || Date.now();
    await renderMarkdownContent(file.name, await file.text(), `已载入本地 Markdown：${file.name}`);
    if (localFileHandle) startLocalFilePolling();
  }

  function startLocalFilePolling() {
    if (!localFileHandle) return;
    localFilePollTimer = window.setInterval(async () => {
      try {
        const file = await localFileHandle.getFile();
        if ((file.lastModified || 0) <= localFileUpdatedAt) return;
        localFileUpdatedAt = file.lastModified || Date.now();
        await renderMarkdownContent(file.name, await file.text(), `本地 Markdown 已自动同步：${file.name}`);
      } catch (error) {
        window.clearInterval(localFilePollTimer);
        localFilePollTimer = null;
        setStatus(`本地文件自动同步已停止：${error.message}`);
      }
    }, 1000);
  }

  async function chooseLocalMarkdownFile() {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: "Markdown 文件",
          accept: {
            "text/markdown": [".md"],
            "text/plain": [".md"]
          }
        }]
      });
      await loadLocalFile(await handle.getFile(), handle);
      return;
    }

    els.localMdInput.click();
  }

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(EXPORT_HANDLE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(EXPORT_HANDLE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readStoredDirectoryHandle() {
    if (!window.indexedDB) return null;
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EXPORT_HANDLE_STORE, "readonly");
      const request = tx.objectStore(EXPORT_HANDLE_STORE).get(EXPORT_DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function saveStoredDirectoryHandle(handle) {
    if (!window.indexedDB || !handle) return;
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(EXPORT_HANDLE_STORE, "readwrite");
      tx.objectStore(EXPORT_HANDLE_STORE).put(handle, EXPORT_DIRECTORY_HANDLE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function chooseBrowserOutputDirectory() {
    if (!window.showDirectoryPicker) return null;

    const storedHandle = await readStoredDirectoryHandle().catch(() => null);
    const options = { id: "xhs-png-export", mode: "readwrite" };
    if (storedHandle) options.startIn = storedHandle;

    const handle = await window.showDirectoryPicker(options);
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      throw new Error("没有写入所选文件夹的权限。");
    }
    await saveStoredDirectoryHandle(handle).catch(() => {});
    return handle;
  }

  function slugifyOutputName(name) {
    return String(name || "untitled")
      .replace(/\.md$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "untitled";
  }

  function base64ToBlob(base64, type) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type });
  }

  async function writePngFilesToDirectory(directoryHandle, sourceName, files) {
    const directoryName = slugifyOutputName(sourceName);
    const targetDir = await directoryHandle.getDirectoryHandle(directoryName, { create: true });
    for (const file of files) {
      const fileHandle = await targetDir.getFileHandle(file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(base64ToBlob(file.data, "image/png"));
      await writable.close();
    }
    return `${directoryHandle.name}\\${directoryName}`;
  }

  async function chooseOutputFolder() {
    const lastFolder = window.localStorage.getItem(LAST_EXPORT_FOLDER_KEY) || "";
    setStatus("正在打开文件夹选择窗口...");
    const data = await fetchJson("/api/select-output-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initialFolder: lastFolder })
    });
    if (!data.folder) {
      setStatus("未选择导出文件夹。");
      return null;
    }
    window.localStorage.setItem(LAST_EXPORT_FOLDER_KEY, data.folder);
    setStatus(`已选择 PNG 输出文件夹：${data.folder}`);
    return data.folder;
  }

  function scheduleAutoReload(fileName) {
    if (currentSourceMode !== "draft") return;
    window.clearTimeout(autoReloadTimer);
    autoReloadTimer = window.setTimeout(async () => {
      try {
        if (fileName === currentFileName) {
          await loadDraft(fileName);
          setStatus(`Markdown 已自动同步：${fileName}`);
          return;
        }
        setStatus(`Markdown 文件已变化：${fileName}`);
      } catch (error) {
        setStatus(`自动同步失败：${error.message}`);
      }
    }, 220);
  }

  function startLiveReload() {
    if (!window.EventSource) {
      setStatus("当前浏览器不支持实时同步，请继续使用刷新文档按钮。");
      return;
    }

    const events = new EventSource("/api/events");
    events.addEventListener("draft-change", event => {
      const payload = JSON.parse(event.data || "{}");
      if (!payload.fileName) return;
      scheduleAutoReload(payload.fileName);
    });
    events.onerror = () => {
      setStatus("实时同步连接暂时中断，保存后可手动刷新文档。");
    };
  }

  async function loadLayoutOverride(fileName) {
    try {
      return await fetchJson(`/api/layout-override?file=${encodeURIComponent(fileName)}`);
    } catch (error) {
      setStatus(`封面排版设置读取失败：${error.message}`);
      return null;
    }
  }

  function renderPreview(parsedInput) {
    if (!activeTemplate || !window.XhsTemplateRenderer) {
      setStatus("模板还在加载中。");
      return;
    }

    const parsed = parsedInput || XhsMarkdownParser.parseMarkdown(els.markdownInput.value, {
      eyebrow: els.eyebrowInput.value.trim() || "NOTES"
    });
    const blocks = applyCoverEditor(parsed.blocks);

    const pages = XhsPaginator.paginate(blocks, {
      measureRoot: els.measureRoot,
      renderer: window.XhsTemplateRenderer,
      template: activeTemplate.config,
      account: els.accountInput.value.trim() || "AUTHOR",
      eyebrow: els.eyebrowInput.value.trim() || "NOTES",
      startPage: 1
    });

    els.previewRoot.innerHTML = "";
    pages.forEach(page => els.previewRoot.appendChild(page));
    els.pageCountText.textContent = `${pages.length} 页`;
    setStatus(`已生成 ${pages.length} 页预览。`);
  }

  function addExportHistory(data) {
    if (!els.exportHistory) return;
    const item = document.createElement("div");
    item.className = "export-history-item";
    item.innerHTML = `
      <strong>${XhsMarkdownParser.escapeHtml(new Date().toLocaleTimeString())}</strong>
      <span>${XhsMarkdownParser.escapeHtml(String(data.pngFiles?.length || 0))} 张 PNG</span>
      <code>${XhsMarkdownParser.escapeHtml(data.outputDir || "")}</code>
    `;
    els.exportHistory.prepend(item);
    Array.from(els.exportHistory.children).slice(5).forEach(node => node.remove());
  }

  async function exportCurrent() {
    renderPreview();
    const pagesHtml = Array.from(els.previewRoot.querySelectorAll(".xhs-page"))
      .map(page => page.outerHTML)
      .join("\n");

    const browserDirectoryHandle = await chooseBrowserOutputDirectory().catch(error => {
      if (error.name === "AbortError") return null;
      throw error;
    });
    if (window.showDirectoryPicker && !browserDirectoryHandle) {
      setStatus("未选择导出文件夹。");
      return;
    }

    const payload = {
      sourceName: currentFileName || "未命名草稿.md",
      title: currentFileName || "小红书排版输出",
      templateId: activeTemplate.id,
      pagesHtml,
      overrideCss: buildOverrideCss(),
      scale: 4
    };

    setStatus("正在导出 PNG...");
    if (browserDirectoryHandle) {
      const data = await fetchJson("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, returnFiles: true })
      });
      const outputDir = await writePngFilesToDirectory(browserDirectoryHandle, currentFileName, data.pngFiles || []);
      const result = {
        outputDir,
        pngFiles: data.pngFiles || []
      };
      setStatus(`导出完成：${result.pngFiles.length} 张 PNG。位置：${result.outputDir}`);
      addExportHistory(result);
      return;
    }

    const outputFolder = await chooseOutputFolder();
    if (!outputFolder) return;
    const data = await fetchJson("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, outputFolder })
    });

    setStatus(`导出完成：${data.pngFiles.length} 张 PNG。位置：${data.outputDir}`);
    addExportHistory(data);
  }

  els.refreshDraftButton.addEventListener("click", () => {
    if (currentSourceMode === "local") {
      if (!localFileHandle) {
        setStatus("当前浏览器不能直接重读这个本地文件，请重新点击“选择本地 MD 文件”。");
        return;
      }
      localFileHandle.getFile()
        .then(file => loadLocalFile(file, localFileHandle))
        .catch(error => setStatus(`刷新本地 Markdown 失败：${error.message}`));
      return;
    }

    if (currentSourceMode === "draft" && currentFileName) {
      loadDraft(currentFileName).catch(error => setStatus(error.message));
      return;
    }

    setStatus("请先选择一个本地 Markdown 文件。");
  });

  els.localMdButton.addEventListener("click", () => {
    chooseLocalMarkdownFile().catch(error => {
      if (error.name === "AbortError") return;
      setStatus(`选择本地 Markdown 失败：${error.message}`);
    });
  });

  els.localMdInput.addEventListener("change", event => {
    const [file] = Array.from(event.target.files || []);
    loadLocalFile(file, null).catch(error => setStatus(`读取本地 Markdown 失败：${error.message}`));
    event.target.value = "";
  });

  els.templateSelect.addEventListener("change", event => {
    loadTemplate(event.target.value)
      .then(renderPreview)
      .catch(error => setStatus(error.message));
  });

  els.presetSelect.addEventListener("change", event => {
    applyPreset(event.target.value);
    renderPreview();
    setEditorStatus(`已切换到样式：${currentPreset().name}。`, "success");
    setStatus(`已切换到样式：${currentPreset().name}`);
  });

  function normalizeHexColor(value) {
    const trimmed = String(value || "").trim();
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
    return trimmed;
  }

  function isValidHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function syncColorControl(input, control, valueText) {
    const colorControl = input.closest(".color-control");
    const hexInput = colorControl?.querySelector(".color-hex-input");
    const nextValue = normalizeHexColor(input.value);

    if (!isValidHexColor(nextValue)) {
      input.classList.add("is-invalid");
      return false;
    }

    input.classList.remove("is-invalid");
    if (hexInput && hexInput !== input) hexInput.value = nextValue;
    if (input.classList.contains("color-hex-input") && input.value !== nextValue) input.value = nextValue;
    colorControl?.querySelector(".color-button")?.style.setProperty("--color-value", nextValue);
    if (valueText) valueText.textContent = nextValue;
    applyControlValue(control, nextValue);
    return true;
  }

  function syncLinkedNumberControls(input, control) {
    const selector = `input[data-group="${input.dataset.group}"][data-control="${input.dataset.control}"]`;
    document.querySelectorAll(selector).forEach(linkedInput => {
      if (linkedInput !== input) linkedInput.value = input.value;
    });
    const valueText = input.closest(".editor-control")?.querySelector(".editor-value");
    if (valueText) valueText.textContent = `${input.value}${control.unit || ""}`;
  }

  function handleEditorControlInput(event) {
    const textElementInput = event.target.closest("input[data-text-element]");
    if (textElementInput) {
      if (textElementInput.dataset.textElement === "account") {
        els.accountInput.value = textElementInput.value;
      }
      if (textElementInput.dataset.textElement === "eyebrow") {
        els.eyebrowInput.value = textElementInput.value;
      }
      renderPreview();
      return;
    }

    const input = event.target.closest("input[data-group]");
    if (!input) return;
    const group = activeTemplate.editor.groups[Number(input.dataset.group)];
    const control = group.controls[Number(input.dataset.control)];
    const valueText = input.closest(".editor-control")?.querySelector(".editor-value");
    if (control.type === "color") {
      syncColorControl(input, control, valueText);
      return;
    }
    syncLinkedNumberControls(input, control);
    applyControlValue(control, input.value);
  }

  let activeStepperHold = null;

  function stepInputByButton(button) {
    const field = button.closest(".property-field");
    const input = field?.querySelector('input[type="number"][data-group][data-control]');
    if (!input) return;

    if (button.dataset.stepperAction === "up") input.stepUp();
    else input.stepDown();

    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function stopNumberStepperHold() {
    if (!activeStepperHold) return;
    window.clearTimeout(activeStepperHold.timeoutId);
    window.clearInterval(activeStepperHold.intervalId);
    activeStepperHold = null;
  }

  function handleNumberStepperPointerDown(event) {
    const button = event.target.closest("button[data-stepper-action]");
    if (!button) return;
    event.preventDefault();
    stopNumberStepperHold();
    stepInputByButton(button);

    const holdState = {
      timeoutId: window.setTimeout(() => {
        holdState.intervalId = window.setInterval(() => {
          stepInputByButton(button);
        }, 70);
      }, 320),
      intervalId: null
    };
    activeStepperHold = holdState;
  }

  els.globalStyleEditor.addEventListener("input", handleEditorControlInput);
  els.templateEditor.addEventListener("input", handleEditorControlInput);
  els.globalStyleEditor.addEventListener("pointerdown", handleNumberStepperPointerDown);
  els.templateEditor.addEventListener("pointerdown", handleNumberStepperPointerDown);

  els.elementSelect.addEventListener("change", event => {
    activeElementEditorId = event.target.value;
    renderElementEditor();
  });

  els.coverStyleEditor.addEventListener("input", handleEditorControlInput);
  els.coverStyleEditor.addEventListener("pointerdown", handleNumberStepperPointerDown);
  window.addEventListener("pointerup", stopNumberStepperHold);
  window.addEventListener("pointercancel", stopNumberStepperHold);
  window.addEventListener("blur", stopNumberStepperHold);

  els.coverHighlightInput.addEventListener("input", event => {
    coverTitleState.highlights = event.target.value;
    renderPreview();
  });

  els.coverLinesEditor.addEventListener("input", event => {
    const input = event.target.closest("input[data-cover-line]");
    if (!input) return;
    coverTitleState.lines[Number(input.dataset.coverLine)] = input.value;
    renderPreview();
  });

  els.saveTemplateButton.addEventListener("click", async () => {
    const originalText = els.saveTemplateButton.textContent;
    try {
      els.saveTemplateButton.disabled = true;
      els.saveTemplateButton.textContent = "保存中...";
      setEditorStatus(`正在保存样式：${currentPreset().name}...`, "");
      const data = await fetchJson("/api/presets/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: activeTemplate.id,
          presetId: activeTemplate.currentPresetId,
          settings: visualSettings
        })
      });
      activeTemplate.config = mergeDeep(activeTemplate.baseConfig, data.settings.config || {});
      upsertPreset(data.preset);
      els.saveTemplateButton.textContent = "已保存";
      setEditorStatus(`样式“${data.preset.name}”已保存，下次打开仍会保留。`, "success");
      setStatus(`样式已保存：${data.preset.name}`);
      window.setTimeout(() => {
        els.saveTemplateButton.textContent = originalText;
      }, 1200);
    } catch (error) {
      els.saveTemplateButton.textContent = originalText;
      setEditorStatus(`保存失败：${error.message}`, "error");
      setStatus(error.message);
    } finally {
      els.saveTemplateButton.disabled = false;
    }
  });

  els.savePresetAsButton.addEventListener("click", async () => {
    const name = window.prompt("给新样式起个名字，例如：商品笔记密排版");
    if (!name || !name.trim()) return;

    const originalText = els.savePresetAsButton.textContent;
    try {
      els.savePresetAsButton.disabled = true;
      els.savePresetAsButton.textContent = "保存中...";
      setEditorStatus("正在另存为新样式...", "");
      const data = await fetchJson("/api/presets/save-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: activeTemplate.id,
          name: name.trim(),
          settings: visualSettings
        })
      });
      upsertPreset(data.preset);
      renderPresetSelect();
      setEditorStatus(`已创建新样式：${data.preset.name}。`, "success");
      setStatus(`已另存为新样式：${data.preset.name}`);
    } catch (error) {
      setEditorStatus(`另存失败：${error.message}`, "error");
      setStatus(error.message);
    } finally {
      els.savePresetAsButton.disabled = false;
      els.savePresetAsButton.textContent = originalText;
    }
  });

  els.saveCoverLayoutButton.addEventListener("click", async () => {
    const originalText = els.saveCoverLayoutButton.textContent;
    try {
      els.saveCoverLayoutButton.disabled = true;
      els.saveCoverLayoutButton.textContent = "保存中...";
      await fetchJson("/api/layout-override/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName: currentFileName,
          coverTitle: coverTitleState
        })
      });
      els.saveCoverLayoutButton.textContent = "已保存";
      setStatus(`本篇封面排版已保存：${currentFileName}`);
      window.setTimeout(() => {
        els.saveCoverLayoutButton.textContent = originalText;
      }, 1200);
    } catch (error) {
      els.saveCoverLayoutButton.textContent = originalText;
      setStatus(`封面排版保存失败：${error.message}`);
    } finally {
      els.saveCoverLayoutButton.disabled = false;
    }
  });

  els.resetTemplateButton.addEventListener("click", () => {
    visualSettings = defaultSettingsFromEditor(activeTemplate.editor);
    activeTemplate.config = mergeDeep(activeTemplate.baseConfig, visualSettings.config);
    applyVisualSettings();
    renderTemplateEditor();
    renderCoverStyleEditor();
    renderPreview();
    setEditorStatus("已恢复为编辑器默认值，点击保存当前样式后才会写入所选预设。", "");
    setStatus("已恢复为编辑器默认值，保存后才会写入所选预设。");
  });

  els.exportButton.addEventListener("click", () => {
    exportCurrent().catch(error => setStatus(error.message));
  });

  els.previewZoomInput.addEventListener("input", event => {
    applyPreviewZoom(Number(event.target.value) / 100);
  });

  [els.accountInput, els.eyebrowInput].forEach(input => {
    input.addEventListener("input", () => renderPreview());
  });

  async function init() {
    applyPreviewZoom(1);
    await loadTemplates();
    setCurrentFileName("");
    setStatus("请选择本地 Markdown 文件。");
    startLiveReload();
  }

  init().catch(error => setStatus(error.message));
})();
