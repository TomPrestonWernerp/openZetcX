# openZetc 0.5.100 × Yuxi 0.7.1

本适配把 Yuxi 作为 openZetc 的统一账号和资源中心，同时保留 openZetc 的本地运行与安装模型。

## 功能边界

- 登录：在「设置 → Yuxi」中使用 Yuxi 账号登录。密码只用于调用 Yuxi `/api/auth/token`，不会写入本地；访问令牌和用户快照保存到 openZetc 数据目录的 `integrations/yuxi.json`。
- 启动验证：登录时可启用「将 Yuxi 登录作为 openZetc 启动验证」。启用后，每次启动都会调用 `/api/auth/me` 验证会话；Token 失效或主动退出后会回到登录页。
- Agent 商店：展示当前账号可访问的 Yuxi Agent。安装后本地 ID 固定为 `yuxi-<slug>`，系统提示词写入 `identity.md`，Yuxi 来源写入 `.yuxi-source.json`；再次操作会同步更新。
- Skill 商店：展示当前账号可访问的 Yuxi Skill。同步使用 Yuxi 的目录树和文件读取接口，并复用 openZetc 的原子 Skill 安装器；来源写入 `.openzetc-yuxi-source.json`。
- 知识库：设置页可直接验证查询；所有本地 Agent 同时获得只读工具 `yuxi_list_knowledge_bases` 和 `yuxi_query_knowledge_base`，调用时使用当前登录账号的 Yuxi 权限。

## 本地地址

- Yuxi API：`http://127.0.0.1:5050`
- Yuxi Web：`http://127.0.0.1:5173`

本机端口被占用时，可在 Yuxi `.env` 中设置 `YUXI_API_PORT` 与 `YUXI_WEB_PORT`；本次联调分别使用 `http://127.0.0.1:15050` 和 `http://127.0.0.1:15173`。在 openZetc 登录页填写 API 地址。为避免明文密码在网络上传输，openZetc 只允许本机地址使用 HTTP；非本机 Yuxi 必须配置 HTTPS。

## Yuxi 配套修改

Yuxi 的 `POST /api/knowledge/databases/{kb_id}/query` 原本只允许管理员调用。适配分支将其调整为任意已登录用户可调用，但查询执行前必须通过知识库既有 `share_config` ACL（全局、部门、指定用户、创建者或超级管理员）；越权返回 403。

## 已知限制

- Yuxi 的 Skill 文件读取接口只返回 UTF-8 文本。图片等二进制资源无法由普通可读权限导出，openZetc 会跳过这些资源并在安装结果中提示数量；`SKILL.md` 缺失时拒绝安装。
- Agent 同步的是名称、系统提示词和已选择的 Skills。Yuxi 后端运行时、模型、MCP、子 Agent 与对话历史不会复制到 openZetc。
- 知识库内容集中保留在 Yuxi，openZetc 只查询，不复制向量、文档或索引。
- Yuxi 的真实语义查询仍依赖可用的模型与嵌入服务配置；仅用占位 API Key 可以验证登录、权限和资源列表，但不能替代模型服务。

## 生产建议

- 对外部署 Yuxi 时使用 HTTPS，并限制 5050 API 端口的网络暴露。
- 使用正式密钥替换本地初始化占位值，按公司/部门/个人范围维护 `share_config`。
- 将 Yuxi 数据库、MinIO、Milvus 和 Neo4j 卷纳入备份；openZetc 本地安装副本不能替代中心资源备份。
- 后续如需自动更新，可在 Yuxi Agent/Skill 增加版本或内容摘要，并由 openZetc 定期比较来源元数据后提示更新。
