# Cloud Run container for Node.js API (server lives under project/server)
# Uses Node 20 LTS on a small Alpine base image.
FROM node:20-alpine

# Build argument to allow overriding the app directory inside the build context.
# Default is "." so this Dockerfile works when the build CONTEXT is the project/ folder.
# If your build CONTEXT is the REPO ROOT, pass --build-arg APP_DIR=project
# so paths resolve correctly.
ARG APP_DIR=.

# Container workdir (fixed). We'll copy sources into /app regardless of context.
WORKDIR /app

# Copy only the app's package manifest(s) first for better layer caching.
# Note: We copy both package.json and package-lock.json (if present) to leverage cache,
# but we will gracefully fall back to `npm install` if `npm ci` detects a mismatch.
COPY ${APP_DIR}/package.json ./
COPY ${APP_DIR}/package-lock.json ./

# Install production dependencies only. Prefer reproducible `npm ci`,
# but if lockfile is out-of-sync, fall back to `npm install --omit=dev`.
RUN npm ci --omit=dev \
	|| (echo "npm ci failed; removing lockfile and falling back to npm install --omit=dev" \
			&& rm -f package-lock.json \
			&& npm install --omit=dev)

# Copy the rest of the app sources from the specified directory within the build context
COPY ${APP_DIR}/. ./

# Environment
ENV NODE_ENV=production
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server. Support both build contexts:
#  - If sources are at /app (context=project), use server/index.js
#  - If sources are under /app/project (context=repo-root), use project/server/index.js
CMD ["/bin/sh", "-c", "if [ -f server/index.js ]; then exec node server/index.js; else exec node project/server/index.js; fi"]
