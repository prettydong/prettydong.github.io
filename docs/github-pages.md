# 个人博客部署

目标仓库：`prettydong/prettydong.github.io`。站点：`https://prettydong.github.io/`。

将项目源码（包括 `blog/`、`public/`、锁文件和 `.github/workflows/pages.yml`）推送至仓库的 `master` 分支。在 Settings → Pages → Build and deployment 中选择 GitHub Actions。工作流安装依赖、构建并发布 `dist/`，不需要提交 `dist/`。Vite 默认根路径适用于这个个人站点。

网站默认进入博客欢迎页，底栏和 Esc 可返回终端。新增文章按 [文章格式](../blog/README.md) 保存到 `blog/YYYY-MM-DD-slug.md`，图片保存到 `public/blog/`。推送到 `master` 后自动重新构建；在仓库 Actions 中检查部署结果。构建失败时不会发布该次内容。

## Agent 管理

本机编程 Agent 可修改仓库里的 Markdown，检查构建后提交并推送；发布由同一个 Pages 工作流完成。GitHub 登录凭据留在本机，不写入源码、文章或 Vite 环境变量。

网站内 Agent 已接入 GitHub 博客插件。可运行 `npm run agent:configure -- --github`，在隐藏输入中填写现有 Agent 解锁密码和 GitHub 令牌；脚本保留 DeepSeek 配置，校验 GitHub 账号及仓库权限后，把两者写入同一份 AES-GCM 密文。完整配置命令 `npm run agent:configure` 也支持同时填写两种令牌。使用 fine-grained token 时，仅选择 `prettydong.github.io`，Contents 读写、Actions 只读，并设置有效期。

构建部署后，在终端输入 `agent` 并输入原解锁密码，即可同时解锁模型和 GitHub 连接。底栏 GitHub 或 `/github` 查看连接；断开后可在专用密码框重新解锁。若源码尚未配置 GitHub 密文，该入口仍支持临时输入令牌。不要把令牌或密码发送给模型。

公开构建只保存密文，明文凭据只在内存使用。锁定、退出或刷新会清除连接；清空对话保留连接，与模型一致。知道解锁密码的人能够取得对应令牌，所以密码用于控制这两个服务的访问，不能用于向已获授权的人隐藏令牌。

可要求 Agent 查看 GitHub 文章、读取全文、基于原文修改本地草稿、预览并发布。发布和删除会弹出确认框；Enter 确认、Esc 取消。每次更新使用 GitHub blob SHA 检查版本，冲突后必须重新读取。发布工具只读取本地已保存草稿，不接受模型直接写入任意仓库路径；删除只允许文章文件。当前不支持通过 Agent 上传图片，图片放入源码 `public/blog/` 后推送。

`github_blog_list` 列出实时文章，`github_blog_read` 分页读取源文及 SHA，`github_blog_publish` 提交草稿，`github_blog_delete` 删除明确指定的文章，`github_blog_status` 查询指定提交的 Pages 部署结果。创建文章的 expectedSha 为 null；修改和删除须使用读取所得 SHA。成功提交不等于部署完成，需等工作流成功后刷新网站查看新内容。

连接区域沿用 Agent 的 Tab / Shift+Tab 循环；令牌框 Enter 连接，Esc 退出 Agent。手机可点击连接、断开及底栏 GitHub。锁定或退出会撤销连接；重新连接时输入原解锁密码。

本机已连接远程的发布工作副本位于 `/Volumes/app/prettydong.github.io`；原站备份分支为 `backup-before-zed-blog-20260928`。在发布工作副本修改文章后，运行 `npm run build` 检查，再提交并推送到 master。浏览器 Agent 提交后，本机修改前先 git pull 同步。
