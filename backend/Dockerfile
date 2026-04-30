FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json knexfile.ts ./
COPY src ./src
COPY migrations ./migrations
COPY seeds ./seeds
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/knexfile.ts ./knexfile.ts
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/seeds ./seeds
EXPOSE 3000
CMD ["node", "dist/index.js"]
