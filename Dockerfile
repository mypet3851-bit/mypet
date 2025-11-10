# Cloud Run container for Node.js API (server lives under project/server)
# Uses Node 20 LTS on a small Alpine base image.
FROM node:20-alpine

# Build argument to allow overriding the app directory (defaults to project)
ARG APP_DIR=project

# Container workdir (inside the app directory)
WORKDIR /app/${APP_DIR}

# Copy only the app's package manifests first for better layer caching
# This works when the Docker build context is the repo root.
COPY ${APP_DIR}/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev || npm ci --only=production

# Copy the rest of the app sources from the specified directory
COPY ${APP_DIR}/. ./

# Environment
ENV NODE_ENV=production
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server from the app directory
CMD ["node", "server/index.js"]
