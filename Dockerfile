FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY cldsh.js ./
COPY lib ./lib
COPY commands ./commands

ENTRYPOINT ["node", "cldsh.js", "--mcp"]
