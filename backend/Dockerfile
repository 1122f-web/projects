# Builds the API from the repository root:
#   docker build -f backend/Dockerfile -t mediconnect-api .
# Configuration comes from environment variables at runtime (see backend/.env.example).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --include-workspace-root=false
COPY backend backend
RUN npm run build --workspace backend && npm prune --omit=dev --workspace backend

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/backend/package.json backend/
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/node_modules backend/node_modules
USER node
EXPOSE 4000
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
