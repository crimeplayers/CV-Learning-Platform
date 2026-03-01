# Zeabur 部署指南

## 项目说明

本项目是一个计算机视觉学习平台，包含前端（React + Vite）和后端（Express + SQLite）。

**重要提示：** 如果前端和后端分别部署在不同的服务上，需要正确配置环境变量让前端能找到后端 API 地址。

## 部署方案

### 方案一：单服务部署（推荐）

前端和后端部署在同一个服务上，Express 服务器同时提供 API 和静态前端文件。

**优点：** 配置简单，无需跨域处理
**缺点：** 资源共享同一服务器

### 方案二：前后端分离部署

前端和后端分别部署在不同的服务上。

**优点：** 资源隔离，可独立扩展
**缺点：** 需要配置 CORS 和前端 API 地址

---

## 方案一：单服务部署步骤

### 1. 在 Zeabur 创建服务

1. 登录 [Zeabur](https://zeabur.com)
2. 创建新项目
3. 连接你的 GitHub 仓库
4. 选择本项目仓库

### 2. 配置环境变量

在 Zeabur 项目设置中，添加以下环境变量：

**必需的环境变量：**

```env
NODE_ENV=production
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
GEMINI_API_KEY=your-gemini-api-key
```

**可选的环境变量：**

```env
PORT=3000
UPLOADS_DIR=./uploads
```

### 3. 配置构建和启动命令

Zeabur 会自动检测 `package.json` 和 `zbpack.json`，使用以下命令：

- **构建命令**: `npm run build`
- **启动命令**: `npm start`

### 4. 部署和验证

1. 点击"部署"按钮
2. 等待构建完成
3. 访问分配的域名
4. 使用默认管理员账号登录：
   - 用户名：`admin`
   - 密码：`admin123`

---

## 方案二：前后端分离部署步骤

如果你需要将前端和后端分别部署在不同的服务上（例如前端使用静态托管，后端使用 Node.js 服务），请按以下步骤操作：

### 后端服务配置

#### 1. 创建后端服务

1. 在 Zeabur 创建一个新服务
2. 连接 GitHub 仓库
3. 设置环境变量：
   ```env
   NODE_ENV=production
   JWT_SECRET=your-secret-key
   GEMINI_API_KEY=your-api-key
   ```

4. Zeabur 会自动使用 `npm start` 启动服务
5. 记录后端服务的 URL（例如：`https://your-backend.zeabur.app`）

### 前端服务配置

#### 1. 创建前端服务

1. 在 Zeabur 创建另一个服务（可以选择静态托管）
2. 连接同一个 GitHub 仓库
3. **关键步骤：** 设置环境变量：
   ```env
   VITE_API_URL=https://your-backend.zeabur.app
   ```
   ⚠️ 注意：这里填写的是后端服务的完整 URL，不要包含 `/api` 路径

4. 构建命令：`npm run build`
5. 发布目录：`dist`

#### 2. 后端添加 CORS 支持

由于前后端部署在不同域名，需要在后端添加 CORS 支持。在 [server.ts](server.ts) 中添加：

```typescript
// 在 app.use(express.json()); 之后添加
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // 生产环境建议设置为具体的前端域名
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
```

#### 3. 验证部署

1. 访问前端 URL
2. 打开浏览器开发者工具（F12）→ Network 标签
3. 尝试登录
4. 确认请求发送到了正确的后端地址（`https://your-backend.zeabur.app/api/auth/login`）

### 环境变量说明

- **VITE_API_URL**: 前端环境变量，指定后端 API 的基础 URL
  - 单服务部署：不需要设置（或设置为空字符串）
  - 前后端分离：设置为后端服务的完整 URL
  - 示例：`https://your-backend.zeabur.app`

---

## 常见问题

### 登录时出现 405 错误（Method Not Allowed）

**原因：** 前端请求发送到了错误的地址（发送到前端服务而不是后端服务）

**解决方案：**

1. **检查部署方式：** 
   - 如果是单服务部署：不需要设置 `VITE_API_URL`
   - 如果是前后端分离：必须在前端服务设置 `VITE_API_URL` 环境变量

2. **验证环境变量：**
   - 在 Zeabur 前端服务的环境变量中添加：`VITE_API_URL=https://your-backend.zeabur.app`
   - 重新部署前端服务

3. **检查请求地址：**
   - 打开浏览器开发者工具 → Network 标签
   - 查看登录请求的 URL 是否正确指向后端服务

### 登录时出现 JSON 解析错误

**原因：** 服务器未正确响应或返回非 JSON 数据

**解决方案：**

1. 检查环境变量是否正确设置（特别是 `NODE_ENV=production`）
2. 查看 Zeabur 日志，确认服务器是否正常启动
3. 确认端口配置正确（Zeabur 会自动注入 PORT 变量）
4. 检查数据库是否正确初始化

### 数据库文件丢失

**原因：** Zeabur 的临时文件系统会在重启时清空

**解决方案：**

考虑使用以下方案之一：
1. 使用 Zeabur 的持久化存储卷
2. 迁移到云数据库（PostgreSQL/MySQL）
3. 使用 Zeabur 提供的 Volume 功能挂载数据目录

### AI 功能不可用

**原因：** 缺少 API Key 或配置错误

**解决方案：**

1. 在 Zeabur 环境变量中设置 `GEMINI_API_KEY`
2. 或者登录管理员账号后，在"管理后台"→"系统设置"中配置

## 本地开发

```bash
# 安装依赖
npm install

# 开发模式（同时启动前端和后端）
npm run dev

# 构建前端
npm run build

# 生产模式
NODE_ENV=production npm start
```

## 技术栈

- **前端**: React 19 + Vite + TailwindCSS
- **后端**: Express + TypeScript
- **数据库**: SQLite (better-sqlite3)
- **AI**: Google Gemini API
- **认证**: JWT + bcrypt

## 项目结构

```
├── src/                  # 前端源码
│   ├── components/       # React 组件
│   ├── App.tsx          # 主应用组件
│   └── main.tsx         # 入口文件
├── server.ts            # Express 服务器
├── server/              # 服务器模块
│   ├── db.ts           # 数据库初始化
│   └── prompts.ts      # AI 提示词
├── netlify/             # Netlify Functions (不用于 Zeabur)
├── package.json         # 项目配置
├── zbpack.json          # Zeabur 配置
└── vite.config.ts       # Vite 配置
```

## 安全建议

1. 修改默认管理员密码（登录后在管理后台修改）
2. 使用强随机字符串作为 `JWT_SECRET`
3. 妥善保管 API Keys
4. 定期备份数据库文件

## 支持

如有问题，请查看项目日志或提交 Issue。
