# Issue tracker: Local Markdown

本项目的规格与开发任务使用本地 Markdown 管理。

## 文件约定

- 每个功能使用 `.scratch/<feature-slug>/` 目录。
- 规格位于 `.scratch/<feature-slug>/spec.md`。
- 开发任务逐个存入 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始按依赖顺序编号。
- 每个任务使用独立文件，文件顶部记录 `Status:` 和 `Blocked by:`。
- 分流状态使用 `triage-labels.md` 中的标签。`/to-tickets` 生成并获确认的任务标记为 `ready-for-agent`。
- `Blocked by:` 列出前置任务编号和标题；没有依赖时写 `None (can start immediately)`。
- 评论和补充记录追加到任务文件的 `## Comments` 下。

## 技能操作

- “发布到 issue tracker”：在上述目录创建对应规格或任务文件。
- “读取任务”：读取用户指定的文件，或按编号查找对应任务。
- 执行任务时，先读取规格与前置任务状态，选择所有阻塞任务均已完成的任务。
- 直接编辑这些配置即可调整约定；切换任务管理平台时再运行初始化技能。
