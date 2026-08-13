# FakeTheater 正式環境映像
#
# 分成兩階段：第一階段裝相依套件（better-sqlite3 是原生模組，沒有預編譯檔時
# 需要 python3/make/g++ 現場編譯），第二階段只帶走編譯結果，
# 讓最終映像不含任何編譯工具鏈。

FROM node:22-slim AS deps

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# --omit=dev 會跳過 playwright（僅測試用，體積數百 MB）
RUN npm ci --omit=dev


FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/faketheater.db

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY FakeTheater ./FakeTheater

# 資料庫放在 /data，部署平台把持久化磁碟掛在這裡就能跨版本保留資料；
# 沒掛磁碟也能跑，只是每次重新部署會回到種子資料的狀態。
RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 3000

# 平台自己的健康檢查優先，這行是給 docker run / docker compose 用的
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
