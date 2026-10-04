FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server.js"]
