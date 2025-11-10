# Cloud Run container for Node.js API (server lives under project/server)
# Uses Node 20 LTS on a small Alpine base image.
FROM node:20-alpine

# Container workdir
WORKDIR /app

# NOTE: This Dockerfile assumes the Docker build CONTEXT is the project/ subfolder
# (e.g., Cloud Build/Cloud Run configured with dir: project). If your context is the
# repo root instead, use project/Dockerfile or adjust COPY paths accordingly.

# Copy package manifests first for better layer caching (project-context)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev || npm ci --only=production

# Copy the rest of the project sources (project-context)
COPY . ./

# Environment
ENV NODE_ENV=production
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server from project root
CMD ["node", "server/index.js"]
