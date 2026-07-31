# openZetcX 0.6.0 × openZetcWeb 0.6.0

openZetcWeb 是统一账号、组织和资源授权中心，openZetcX 保持本地运行与安装模型。两端共享同一访问令牌和 RBAC 判定结果，但密码不会保存在本地。

## 认证链路

- 登录调用 `POST /api/auth/token` 获取访问令牌。
- 登录完成和每次会话校验同时调用 `GET /api/auth/me` 与 `GET /api/rbac/me`。
- 本地会话保存令牌、用户快照、角色列表和权限范围，不保存密码。
- 启用“启动时验证登录”后，令牌失效会阻止进入应用；未启用时令牌失效不会影响本地功能，但线上资源不可用。
- 旧版 schema 1 会话会在首次在线校验后迁移为包含 RBAC 快照的 schema 2。

## 权限与资源

- Agent：需要 `agent.view` 才显示和同步；服务端继续校验资源可见范围。
- Skill：需要 `skill.view` 才显示和同步；Skill 市场在无权限时关闭。
- 知识库：`knowledge.view` 控制目录和原文读取，`knowledge.query` 控制 RAG、全文和图谱检索。
- MCP：需要 `mcp.view` 才显示；`mcp.use` 决定线上是否可调用。MCP 凭据保留在 openZetcWeb，不复制到桌面端。
- 角色和权限调整后，重新验证会话即可刷新本地权限快照和资源缓存。

所有资源操作都执行两层校验：openZetcX 先根据 RBAC 快照控制入口，openZetcWeb 再基于用户、角色、部门、资源所有者和共享范围强制鉴权。前端状态不能绕过后端权限。

## 本地联调

- openZetcWeb API：`http://127.0.0.1:15050`
- openZetcWeb 页面：`http://127.0.0.1:15173`

本机地址允许 HTTP；非本机服务必须使用 HTTPS。知识库语义检索仍依赖有效的模型、嵌入和重排服务配置。

## 安全边界

- openZetcX 不复制中心知识库的向量、图谱、文档索引或 MCP 密钥。
- 本地安装的 Agent 和 Skill 是授权时刻的副本；中心权限撤销会立即阻止后续线上访问，但不会自动删除既有本地文件。
- 对外部署时应使用 HTTPS，并备份 PostgreSQL、MinIO、Milvus 和 Neo4j 数据卷。
