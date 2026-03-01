# 使用官方的 Node.js 20 环境作为基础
FROM node:20-alpine

# 设置容器内的工作目录
WORKDIR /app

# 先复制 package.json 和 package-lock.json，安装依赖
COPY package*.json ./
RUN npm install

# 把项目的所有代码复制到容器里
COPY . .

# 暴露后端端口（Zeabur 会自动处理，这里写 3000 作为默认标识）
EXPOSE 3000

# 启动后端的命令
CMD["npx", "tsx", "server.ts"]