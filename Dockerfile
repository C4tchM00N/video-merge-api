# 使用Node.js官方镜像作为基础
FROM node:22-alpine

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 安装ffmpeg
RUN apk add --no-cache ffmpeg

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 8080

# 启动命令
CMD ["node", "server.js"]
