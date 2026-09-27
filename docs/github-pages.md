# 个人博客部署

目标仓库：`prettydong/prettydong.github.io`。站点：`https://prettydong.github.io/`。

将项目源码（包括 `blog/`、`public/`、锁文件和 `.github/workflows/pages.yml`）推送至仓库的 `master` 分支。在 Settings → Pages → Build and deployment 中选择 GitHub Actions。工作流安装依赖、构建并发布 `dist/`，不需要提交 `dist/`。Vite 默认根路径适用于这个个人站点。

网站默认进入博客欢迎页，底栏和 Esc 可返回终端。新增文章按 [文章格式](../blog/README.md) 保存到 `blog/YYYY-MM-DD-slug.md`，图片保存到 `public/blog/`。推送到 `master` 后自动重新构建；在仓库 Actions 中检查部署结果。构建失败时不会发布该次内容。

## Agent 管理

本机编程 Agent 可修改仓库里的 Markdown，检查构建后提交并推送；发布由同一个 Pages 工作流完成。GitHub 登录凭据留在本机，不写入源码、文章或 Vite 环境变量。

网站内 Agent 已接入 GitHub 博客插件。在终端输入 `agent`，解锁模型后点击底栏 GitHub 或输入 `/github`。创建 fine-grained personal access token，仅选择 `prettydong.github.io`，Contents 读写、Actions 只读，并设置有效期。令牌在专用密码输入框输入，不要发送到聊天。令牌只保存在当前 Agent 会话内存，清空、锁定、退出或刷新后断开，不会写入浏览器存储、网站构建或模型上下文。浏览器请求直接发往 GitHub，不需要另外部署后端。

可要求 Agent 查看 GitHub 文章、读取全文、基于原文修改本地草稿、预览并发布。发布和删除会弹出确认框；Enter 确认、Esc 取消。每次更新使用 GitHub blob SHA 检查版本，冲突后必须重新读取。发布工具只读取本地已保存草稿，不接受模型直接写入任意仓库路径；删除只允许文章文件。当前不支持通过 Agent 上传图片，图片放入源码 `public/blog/` 后推送。

`github_blog_list` 列出实时文章，`github_blog_read` 分页读取源文及 SHA，`github_blog_publish` 提交草稿，`github_blog_delete` 删除明确指定的文章，`github_blog_status` 查询指定提交的 Pages 部署结果。创建文章的 expectedSha 为 null；修改和删除须使用读取所得 SHA。成功提交不等于部署完成，需等工作流成功后刷新网站查看新内容。

连接区域沿用 Agent 的 Tab / Shift+Tab 循环；令牌框 Enter 连接，Esc 退出 Agent。手机可点击连接、断开及底栏 GitHub。清空、锁定或退出会撤销连接；重新连接时再次输入令牌。
