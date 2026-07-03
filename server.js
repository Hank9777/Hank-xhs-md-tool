// 本地网页工具服务端：读取 Markdown，并按模板系统导出小红书 PNG。
// 关联模块：public 前端排版器、templates 模板目录、本地草稿目录、PNG 输出目录。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadLocalEnv();

const ROOT = path.resolve(__dirname);
function resolveProjectPath(value, fallback) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return fallback;
  return path.isAbsolute(rawValue) ? rawValue : path.resolve(ROOT, rawValue);
}

const PUBLIC_DIR = path.join(__dirname, "public");
const TEMPLATE_DIR = path.join(__dirname, "templates");
const LAYOUT_OVERRIDE_DIR = path.join(__dirname, "layout-overrides");
const DRAFT_DIR = resolveProjectPath(process.env.XHS_DRAFT_DIR, path.join(ROOT, "examples", "drafts"));
const PNG_OUTPUT_DIR = resolveProjectPath(process.env.XHS_OUTPUT_DIR, path.join(ROOT, "exports"));
const PORT = Number(process.env.PORT || 4321);
const liveClients = new Set();
let draftWatcher = null;
let draftNotifyTimer = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function sendLiveEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastDraftChange(fileName) {
  const payload = {
    fileName,
    updatedAt: new Date().toISOString()
  };
  liveClients.forEach(client => {
    sendLiveEvent(client, "draft-change", payload);
  });
}

function startLiveEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  sendLiveEvent(res, "connected", { ok: true });
  liveClients.add(res);
  req.on("close", () => {
    liveClients.delete(res);
  });
}

function setupDraftWatcher() {
  if (draftWatcher || !fs.existsSync(DRAFT_DIR)) return;

  draftWatcher = fs.watch(DRAFT_DIR, (eventType, fileName) => {
    if (!fileName || path.extname(String(fileName)) !== ".md") return;
    clearTimeout(draftNotifyTimer);
    draftNotifyTimer = setTimeout(() => {
      broadcastDraftChange(String(fileName));
    }, 180);
  });

  draftWatcher.on("error", error => {
    console.error(`Markdown 实时监听失败：${error.message}`);
  });
}

function safeDraftPath(fileName) {
  const resolved = path.resolve(DRAFT_DIR, fileName);
  if (!resolved.startsWith(path.resolve(DRAFT_DIR)) || path.extname(resolved) !== ".md") {
    throw new Error("无效的草稿文件路径");
  }
  return resolved;
}

function slugifyName(name) {
  return name
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function resolveExportDir(outputFolder, safeName) {
  const folder = String(outputFolder || "").trim();
  if (!folder) return path.join(PNG_OUTPUT_DIR, safeName);

  const resolved = path.resolve(folder);
  if (!path.isAbsolute(resolved)) {
    throw new Error("导出文件夹请填写绝对路径。");
  }

  return path.join(resolved, safeName);
}

function escapePowerShellSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''");
}

function selectOutputFolder(res, payload = {}) {
  const initialFolder = String(payload.initialFolder || "").trim();
  const initialFolderScript = initialFolder && path.isAbsolute(initialFolder) && fs.existsSync(initialFolder)
    ? `$dialog.SelectedPath = '${escapePowerShellSingleQuoted(initialFolder)}'`
    : "";
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = '选择 PNG 导出文件夹'",
    "$dialog.ShowNewFolderButton = $true",
    initialFolderScript,
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }"
  ].filter(Boolean).join("; ");

  execFile("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    windowsHide: false,
    timeout: 120000
  }, (error, stdout) => {
    if (error) {
      sendJson(res, 500, { error: `选择文件夹失败：${error.message}` });
      return;
    }
    sendJson(res, 200, { folder: stdout.trim() });
  });
}

function safeTemplateId(templateId) {
  const id = templateId || "deep-reading";
  if (!/^[a-z0-9-]+$/i.test(id)) {
    throw new Error("无效的模板 ID");
  }
  return id;
}

function safePresetId(presetId) {
  const id = presetId || "default";
  if (!/^[a-z0-9-]+$/i.test(id)) {
    throw new Error("无效的样式 ID");
  }
  return id;
}

function slugifyPresetName(name) {
  const safeName = String(name || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 48);
  return safeName || `preset-${Date.now()}`;
}

function getTemplateDir(templateId) {
  const id = safeTemplateId(templateId);
  const dir = path.resolve(TEMPLATE_DIR, id);
  if (!dir.startsWith(path.resolve(TEMPLATE_DIR)) || !fs.existsSync(path.join(dir, "template.json"))) {
    throw new Error(`模板不存在：${id}`);
  }
  return dir;
}

function getPresetDir(templateId) {
  const dir = path.resolve(getTemplateDir(templateId), "presets");
  if (!dir.startsWith(getTemplateDir(templateId))) {
    throw new Error("无效的样式目录");
  }
  return dir;
}

function readTemplateConfig(templateId) {
  const dir = getTemplateDir(templateId);
  return JSON.parse(fs.readFileSync(path.join(dir, "template.json"), "utf8"));
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mergeDeep(base, patch) {
  const result = Array.isArray(base) ? base.slice() : { ...base };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = mergeDeep(result[key] || {}, value);
      return;
    }
    result[key] = value;
  });
  return result;
}

function cssFromVisualSettings(settings) {
  const variables = settings?.variables || {};
  const rows = Object.entries(variables)
    .filter(([name, value]) => /^--[a-z0-9-]+$/i.test(name) && isSafeCssValue(value))
    .map(([name, value]) => `  ${name}: ${value};`);

  return rows.length ? `:root {\n${rows.join("\n")}\n}` : "";
}

function isSafeCssValue(value) {
  return typeof value === "string" && value.length < 120 && !/[;{}<>]/.test(value);
}

function sanitizeVisualSettings(settings) {
  const safeVariables = {};
  Object.entries(settings?.variables || {}).forEach(([name, value]) => {
    if (/^--[a-z0-9-]+$/i.test(name) && isSafeCssValue(value)) {
      safeVariables[name] = value;
    }
  });

  return {
    variables: safeVariables,
    config: settings?.config && typeof settings.config === "object" ? settings.config : {}
  };
}

function normalizePreset(rawPreset, presetId) {
  const settings = sanitizeVisualSettings(rawPreset || {});
  return {
    id: safePresetId(rawPreset?.id || presetId),
    name: String(rawPreset?.name || "默认样式"),
    description: String(rawPreset?.description || ""),
    variables: settings.variables,
    config: settings.config
  };
}

function readPreset(templateId, presetId) {
  const id = safePresetId(presetId);
  const filePath = path.join(getPresetDir(templateId), `${id}.json`);
  if (!fs.existsSync(filePath)) {
    const legacySettings = readJsonIfExists(path.join(getTemplateDir(templateId), "visual-settings.json"), {
      variables: {},
      config: {}
    });
    return normalizePreset({ id: "default", name: "默认样式", ...legacySettings }, "default");
  }
  return normalizePreset(JSON.parse(fs.readFileSync(filePath, "utf8")), id);
}

function listPresets(templateId) {
  const presetDir = getPresetDir(templateId);
  if (!fs.existsSync(presetDir)) {
    return [readPreset(templateId, "default")];
  }

  const presets = fs.readdirSync(presetDir)
    .filter(fileName => fileName.endsWith(".json") && fileName !== "current.json")
    .map(fileName => {
      try {
        return readPreset(templateId, path.basename(fileName, ".json"));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);

  return presets.length ? presets : [readPreset(templateId, "default")];
}

function readCurrentPresetId(templateId) {
  const current = readJsonIfExists(path.join(getPresetDir(templateId), "current.json"), {});
  return safePresetId(current.currentPresetId || "default");
}

function writePreset(templateId, preset) {
  const dir = getPresetDir(templateId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${safePresetId(preset.id)}.json`), `${JSON.stringify(preset, null, 2)}\n`, "utf8");
}

function writeCurrentPresetId(templateId, presetId) {
  const dir = getPresetDir(templateId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "current.json"), `${JSON.stringify({ currentPresetId: safePresetId(presetId) }, null, 2)}\n`, "utf8");
}

function settingsFromPreset(preset) {
  return {
    variables: preset.variables || {},
    config: preset.config || {}
  };
}

function safeLayoutOverridePath(sourceName) {
  const safeName = slugifyName(sourceName || "untitled");
  const filePath = path.resolve(LAYOUT_OVERRIDE_DIR, `${safeName}.json`);
  if (!filePath.startsWith(path.resolve(LAYOUT_OVERRIDE_DIR))) {
    throw new Error("无效的文章排版设置路径");
  }
  return filePath;
}

function sanitizeCoverTitle(value) {
  const lines = Array.isArray(value?.lines) ? value.lines : [];
  return {
    lines: lines.map(line => String(line).slice(0, 80)).filter(Boolean).slice(0, 12),
    highlights: String(value?.highlights || "").slice(0, 240)
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("请求内容过大"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function listTemplates(res) {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    sendJson(res, 200, { templates: [] });
    return;
  }

  const templates = fs.readdirSync(TEMPLATE_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      try {
        const dir = getTemplateDir(entry.name);
        const baseConfig = readTemplateConfig(entry.name);
        const presets = listPresets(entry.name);
        const currentPresetId = readCurrentPresetId(entry.name);
        const currentPreset = presets.find(preset => preset.id === currentPresetId) || presets[0];
        const settings = settingsFromPreset(currentPreset);
        const editor = readJsonIfExists(path.join(dir, "editor.json"), { groups: [] });
        const config = mergeDeep(baseConfig, settings.config || {});
        return {
          id: config.id,
          name: config.name,
          description: config.description || "",
          default: Boolean(config.default),
          baseConfig,
          config,
          editor,
          settings,
          presets,
          currentPresetId: currentPreset.id,
          assets: {
            tokensCss: `/templates/${config.id}/tokens.css`,
            componentsCss: `/templates/${config.id}/components.css`,
            rendererJs: `/templates/${config.id}/renderer.js`,
            previewPng: fs.existsSync(path.join(TEMPLATE_DIR, config.id, "preview.png"))
              ? `/templates/${config.id}/preview.png`
              : null
          }
        };
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);

  sendJson(res, 200, { templates });
}

function savePreset(res, payload) {
  const templateId = safeTemplateId(payload.templateId);
  const presetId = safePresetId(payload.presetId);
  const oldPreset = readPreset(templateId, presetId);
  const settings = sanitizeVisualSettings(payload.settings || {});
  const preset = normalizePreset({ ...oldPreset, ...settings, id: presetId }, presetId);
  writePreset(templateId, preset);
  writeCurrentPresetId(templateId, preset.id);
  sendJson(res, 200, { ok: true, preset, settings: settingsFromPreset(preset) });
}

function savePresetAs(res, payload) {
  const templateId = safeTemplateId(payload.templateId);
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("请先输入新样式名称");
  const settings = sanitizeVisualSettings(payload.settings || {});
  let presetId = slugifyPresetName(name);
  const presetDir = getPresetDir(templateId);
  let index = 2;
  while (fs.existsSync(path.join(presetDir, `${presetId}.json`))) {
    presetId = `${slugifyPresetName(name)}-${index}`;
    index += 1;
  }

  const preset = normalizePreset({ id: presetId, name, description: "", ...settings }, presetId);
  writePreset(templateId, preset);
  writeCurrentPresetId(templateId, preset.id);
  sendJson(res, 200, { ok: true, preset, settings: settingsFromPreset(preset) });
}

function listDrafts(res) {
  if (!fs.existsSync(DRAFT_DIR)) {
    sendJson(res, 200, { drafts: [] });
    return;
  }

  const drafts = fs.readdirSync(DRAFT_DIR)
    .filter(name => name.endsWith(".md"))
    .map(name => {
      const stat = fs.statSync(path.join(DRAFT_DIR, name));
      return {
        name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  sendJson(res, 200, { drafts });
}

function readDraft(res, fileName) {
  const filePath = safeDraftPath(fileName);
  const content = fs.readFileSync(filePath, "utf8");
  sendJson(res, 200, { fileName, content });
}

function readLayoutOverride(res, sourceName) {
  const filePath = safeLayoutOverridePath(sourceName);
  const override = readJsonIfExists(filePath, {});
  sendJson(res, 200, {
    sourceName,
    coverTitle: sanitizeCoverTitle(override.coverTitle || {})
  });
}

function saveLayoutOverride(res, payload) {
  const filePath = safeLayoutOverridePath(payload.sourceName || "");
  fs.mkdirSync(LAYOUT_OVERRIDE_DIR, { recursive: true });
  const override = {
    sourceName: String(payload.sourceName || ""),
    coverTitle: sanitizeCoverTitle(payload.coverTitle || {})
  };
  fs.writeFileSync(filePath, `${JSON.stringify(override, null, 2)}\n`, "utf8");
  sendJson(res, 200, { ok: true, override });
}

function buildExportHtml(title, bodyHtml, templateId, overrideCss) {
  const templateDir = getTemplateDir(templateId);
  const settings = settingsFromPreset(readPreset(templateId, readCurrentPresetId(templateId)));
  const css = ["tokens.css", "components.css"]
    .map(fileName => fs.readFileSync(path.join(templateDir, fileName), "utf8"))
    .concat(cssFromVisualSettings(settings), overrideCss || "")
    .join("\n\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    ${css}
    body { margin: 0; background: #ece9e2; }
    .export-sheet { display: grid; gap: 32px; justify-content: center; padding: 32px; }
  </style>
</head>
<body>
  <main class="export-sheet">${bodyHtml}</main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requirePlaywright() {
  return require("playwright");
}

async function exportPages(res, payload) {
  const sourceName = payload.sourceName || "untitled";
  const pagesHtml = payload.pagesHtml || "";
  const title = payload.title || sourceName;
  const templateId = safeTemplateId(payload.templateId);
  const overrideCss = typeof payload.overrideCss === "string" ? payload.overrideCss.slice(0, 20000) : "";
  const scale = Number(payload.scale || 2);
  const returnFiles = Boolean(payload.returnFiles);
  const safeName = slugifyName(sourceName);
  const html = buildExportHtml(title, pagesHtml, templateId, overrideCss);

  const outputDir = returnFiles ? "" : resolveExportDir(payload.outputFolder, safeName);
  if (!returnFiles) fs.mkdirSync(outputDir, { recursive: true });

  const { chromium } = requirePlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1300 },
    deviceScaleFactor: Math.max(1, Math.min(scale, 3))
  });

  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const cards = await page.$$(".xhs-page");
  const pngFiles = [];
  for (let index = 0; index < cards.length; index += 1) {
    const fileName = `${String(index + 1).padStart(2, "0")}.png`;
    if (returnFiles) {
      const buffer = await cards[index].screenshot({ type: "png" });
      pngFiles.push({
        name: fileName,
        data: buffer.toString("base64")
      });
      continue;
    }

    const pngPath = path.join(outputDir, fileName);
    await cards[index].screenshot({ path: pngPath, type: "png" });
    pngFiles.push(pngPath);
  }

  await browser.close();
  sendJson(res, 200, { outputDir, pngFiles, directoryName: safeName });
}

function serveStatic(res, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), MIME_TYPES[ext] || "application/octet-stream");
}

function serveTemplateAsset(res, pathname) {
  const relativePath = decodeURIComponent(pathname.replace(/^\/templates\//, ""));
  const filePath = path.resolve(TEMPLATE_DIR, relativePath);
  if (!filePath.startsWith(path.resolve(TEMPLATE_DIR)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), MIME_TYPES[ext] || "application/octet-stream");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/api/events") {
      startLiveEvents(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/templates") {
      listTemplates(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/drafts") {
      listDrafts(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/draft") {
      readDraft(res, url.searchParams.get("file") || "");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/layout-override") {
      readLayoutOverride(res, url.searchParams.get("file") || "");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/select-output-folder") {
      const body = await readRequestBody(req);
      const payload = body ? JSON.parse(body) : {};
      selectOutputFolder(res, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/export") {
      const payload = JSON.parse(await readRequestBody(req));
      await exportPages(res, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/presets/save") {
      const payload = JSON.parse(await readRequestBody(req));
      savePreset(res, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/presets/save-as") {
      const payload = JSON.parse(await readRequestBody(req));
      savePresetAs(res, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/layout-override/save") {
      const payload = JSON.parse(await readRequestBody(req));
      saveLayoutOverride(res, payload);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/templates/")) {
      serveTemplateAsset(res, url.pathname);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  setupDraftWatcher();
  console.log(`小红书 MD 排版工具已启动：http://localhost:${PORT}`);
});
