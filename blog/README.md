# 博客内容

在本目录添加 UTF-8 Markdown 文件，文件名建议为 `YYYY-MM-DD-slug.md`，例如 `2026-09-26-hello.md`。首个一级标题作为文章标题，文件名前缀作为日期；没有日期的文章排在最后。同一天按文件名排序。本 README 不会出现在文章列表中，只读取本目录直属的 `.md` 文件。

```markdown
---
abstract: 这里填写独立摘要，列表中仅聚焦文章时显示，正文标题下始终显示。
creators: [human, openai]
---

# 文章标题

从这里开始写正文。

## 正文

从这里开始写。
```

每篇新文章在开头的 YAML 元数据中填写两个字段：

- `abstract`：非空纯文本摘要，不必在正文重复。长摘要可用 YAML 的 `>-` 折行语法，包含 `: ` 或 `#` 等 YAML 特殊字符时用引号包住文本。
- `creators`：创作者数组，按填写顺序显示。`human` 为 Zed Huang 的小手标记；`openai`、`anthropic`、`google`、`deepseek` 分别显示对应厂商的 logo。本人独立写作为 `[human]`，AI 独立写作为 `[openai]`，混合写作为 `[human, openai, anthropic]`；也支持多个 AI 共同写作。重复值会合并。

创作者无法确认时填 `creators: []`，页面显示“未标注”，不会默认归属本人或 AI。《从这里开始》是项目介绍，标记为 `creators: [openai]`。旧文章没有元数据时兼容首段摘要和“未标注”；添加元数据后必须填写两个字段，格式错误或不支持的创作者会报告文章路径。摘要及创作者名称也参与搜索。元数据不会作为 Markdown 正文显示。

创作者图标使用主题文字色，不是操作按钮，不增加 Tab 停靠点。小手为本项目绘制；厂商 SVG 来自 [Lobe Icons](https://github.com/lobehub/lobe-icons) 的 `@lobehub/icons-static-svg@1.95.1`，本地保存在 `public/blog/creators/`，许可见 `public/licenses/Lobe-Icons-MIT.txt`。

在 Zed System 输入 `blog` 打开欢迎页，再点击“浏览文章”，或 `blog 2026-09-26-hello` 直接打开。文章内容随 Vite 构建打包，添加或修改后重新构建并部署即可更新。开发模式会自动更新。

图片放在 `public/blog/`，正文使用 `![说明](/blog/image.png)` 引用；外部链接使用完整网址。支持 GFM 表格、任务列表和代码高亮，不执行 Markdown 中的 HTML。

此目录是项目源码里的文章库，与浏览器 IndexedDB 中的虚拟工作区分开。终端里的 `edit` 修改浏览器本地文件，不会改动本目录或发布文章。请只放准备公开的内容；草稿放在本目录之外。

示例文章 `2026-09-26-welcome.md` 可直接替换或删除。

欢迎页插画位于 `public/blog/bulma-openai-time-machine.png`，由内置 image_gen 工具生成。插画不含 Codex 字样，机身及服饰徽章使用 OpenAI 标志。欢迎页桌面端左侧为插画，右侧文字右对齐：小字号博客标识、大字号姓名、分行的职业与爱好；下方细分隔线连接文章数量与“浏览文章”入口。手机端上下排列，文字仍右对齐。进入列表时插画缩至三分之一，和精简介绍一起移到顶部，列表淡入；博客内不显示超四悟空背景。欢迎页、列表及正文均采用居中限宽布局，两侧留白；列表和正文通过底栏“博客首页”或非输入状态下按 `H` 返回欢迎页。
