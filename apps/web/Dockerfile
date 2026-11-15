FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run check && npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
RUN addgroup -S aados && adduser -S aados -G aados
USER aados
EXPOSE 3000
CMD ["node", "build"]
