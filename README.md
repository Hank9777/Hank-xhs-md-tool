# 小红书 MD 排版工具

一个本地运行的 Markdown 排版工具，可以把长文自动分页成 900 x 1200 的小红书图文卡片，并导出 PNG。

它适合知识笔记、方法论文章、案例拆解、课程内容和长文图文排版。你可以先专注写 Markdown，再用模板系统统一控制封面、标题、正文、列表、金句、页脚和颜色。

## 功能特点

- 选择本地 Markdown 文件并实时预览排版效果。
- 自动把内容分页成小红书常用的 3:4 竖版页面。
- 支持封面标题、H1/H2/H3、正文、列表、金句、强制分页。
- 左侧可视化编辑模板参数，右侧实时展示页面。
- 支持保存样式预设，也支持单篇封面标题微调。
- 导出 PNG 时选择本地文件夹，导出倍率默认 4x。
- 模板系统独立于主程序，可以新增、复制或替换模板。

## 环境要求

- Node.js 18 或更高版本。
- npm。
- Windows、macOS、Linux 均可运行。导出 PNG 依赖 Playwright Chromium。

## 本地部署

### 前置准备

在开始之前，请确保你的电脑已安装以下工具：

1. **Node.js 18 或更高版本**
   - 下载地址：https://nodejs.org/
   - 建议下载 LTS（长期支持）版本
   - 安装后在命令行输入 `node -v` 验证，能看到版本号即成功

2. **Git（可选）**
   - 下载地址：https://git-scm.com/
   - 如果不想用 Git，也可以直接下载项目压缩包

### 详细步骤

#### 步骤 1：获取项目代码

**方式 A：使用 Git（推荐）**

打开命令行（Windows 按 `Win + R` 输入 `cmd`，Mac 打开终端），输入：

```bash
git clone https://github.com/Hank9777/Hank-xhs-md-tool.git
cd hanks-xhs-md-tool
```

**方式 B：直接下载**

如果你没有安装 Git，可以：
1. 访问项目页面
2. 点击绿色的 `Code` 按钮
3. 选择 `Download ZIP`
4. 解压到任意文件夹
5. 在命令行里进入该文件夹

#### 步骤 2：安装依赖

在项目文件夹里，输入以下命令：

```bash
npm install
```

这一步会下载项目需要的所有依赖包，可能需要几分钟，请耐心等待。

安装完成后，继续安装浏览器内核（用于导出图片）：

```bash
npx playwright install chromium
```

#### 步骤 3：启动服务

输入以下命令启动本地服务器：

```bash
npm run dev
```

**Windows 用户快捷方式**：也可以直接双击项目文件夹里的 `run-dev.bat` 文件，不需要打开命令行。

看到类似这样的提示就说明启动成功了：

```text
Server running at http://localhost:4321
```

#### 步骤 4：打开浏览器使用

在浏览器地址栏输入：

```text
http://localhost:4321
```

现在你可以：
- 点击”选择本地 MD 文件”导入你自己的 Markdown 文件
- 或者先试试项目内置的示例文件：`examples/drafts/sample-note.md`

### 部署常见问题

**Q：命令行显示 `command not found: node`？**  
A：说明 Node.js 没有安装或没有添加到环境变量，请重新安装 Node.js。

**Q：npm install 报错？**  
A：尝试切换 npm 镜像源（国内用户推荐）：
```bash
npm config set registry https://registry.npmmirror.com
```

**Q：端口 4321 被占用？**  
A：参考下方”可选配置”章节修改端口。

## Markdown 写法

```md
# 封面主标题|第二行标题

## 正文一级标题

### 正文二级标题

#### 正文三级标题

普通正文段落，可以使用 **加粗文字**。

> 这是一段金句或强调引用。

- 无序列表
- 第二项

1. 有序列表
2. 第二步

---

## 新的一页
```

规则：

- `#` 生成封面标题，`|` 可手动分行。
- `##` 生成正文页 H1。
- `###` 生成正文页 H2。
- `####` 生成正文页 H3。
- `>` 生成金句块。
- `-` 生成无序列表。
- `1.` 生成有序列表。
- `---` 强制分页。
- 整段 `**加粗**` 会渲染为强调块。

## 模板系统

模板位于：

```text
templates/[template-id]/
```

当前内置模板：

```text
templates/deep-reading/
```

一个模板通常包含：

- `template.json`：模板 ID、名称、页面尺寸、分页规则、支持的内容块。
- `tokens.css`：颜色、字体、字号、页面尺寸、边距等设计变量。
- `components.css`：封面、标题、正文、列表、金句、页脚等具体样式。
- `renderer.js`：把 Markdown 解析后的语义块渲染成模板 HTML。
- `editor.json`：定义左侧可视化编辑器里出现哪些参数。
- `presets/*.json`：模板下的样式预设。
- `preview.png`：可选的模板预览图。

## 新增模板

推荐复制现有模板再改：

```text
templates/deep-reading/
```

复制为：

```text
templates/my-template/
```

然后修改：

- `template.json` 里的 `id`、`name`、`description`。
- `tokens.css` 里的颜色、字体、尺寸变量。
- `components.css` 里的具体组件样式。
- `renderer.js` 里的模板 ID 和渲染结构。
- `editor.json` 里的可视化编辑参数。

只要模板目录符合结构，服务端会自动读取并显示在“样式模板”下拉框里。新增普通视觉模板通常不需要修改 `server.js` 或 `public/app.js`。

## 用参考图生成模板

可以用参考图片和 Codex 生成新模板。建议先定义这些信息：

```text
模板名称：
目标内容类型：
参考图片：
页面尺寸：
视觉关键词：
封面规则：
正文页规则：
颜色体系：
字体气质：
需要暴露的编辑参数：
```

如果只是改变视觉风格，通常只需要新增模板目录。若要新增全新的语义组件，比如图片网格、数据图表、双栏排版，可能需要扩展 `renderer.js` 或 Markdown 解析逻辑。


## 常见问题

### 导出 PNG 失败

先确认依赖安装完成：

```bash
npm install
npx playwright install chromium
```

### 端口被占用

修改 `.env`：

```env
PORT=4322
```

然后重新启动：

```bash
npm run dev
```

### 模板没有出现在下拉框

检查：

- 模板目录是否放在 `templates/` 下。
- `template.json` 是否存在。
- `template.json` 里的 `id` 是否和目录名一致。
- `renderer.js` 是否注册了 `window.XhsTemplateRenderer`。

