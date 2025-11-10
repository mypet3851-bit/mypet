# Cloud Run container for Node.js API (server lives under project/server)
# Uses Node 20 LTS on a small Alpine base image.
FROM node:20-alpine

# Build argument to allow overriding the app directory inside the build context.
# Default is "." so this Dockerfile works when the build CONTEXT is the project/ folder.
# If your build CONTEXT is the REPO ROOT, pass --build-arg APP_DIR=project
# so paths resolve correctly.
ARG APP_DIR=.

# Container workdir (inside the app directory)
WORKDIR /app/${APP_DIR}

# Copy only the app's package manifests first for better layer caching.
# With APP_DIR=., this copies package*.json from the current build context (e.g., project/).
# With APP_DIR=project and repo-root context, this copies project/package*.json.
COPY ${APP_DIR}/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev || npm ci --only=production

# Copy the rest of the app sources from the specified directory within the build context
COPY ${APP_DIR}/. ./

# Environment
ENV NODE_ENV=production
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server from the app directory
CMD ["node", "server/index.js"]
