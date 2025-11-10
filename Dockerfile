# Cloud Run container for Node.js API (server lives under project/server)
# Uses Node 20 LTS on a small Alpine base image.
FROM node:20-alpine

##
## Simplified: assume DOCKER BUILD CONTEXT = REPO ROOT.
## We always copy the project/ subfolder explicitly. This removes ambiguity that caused
## /app/project/server/index.js to be missing when APP_DIR was mis-set during Cloud Build.
## If you want to build from the project subfolder directly, use the separate project/Dockerfile instead.
##

ARG NODE_ENV=production

WORKDIR /app/project

# Copy only the app's package manifest(s) first for better layer caching.
# Note: We copy both package.json and package-lock.json (if present) to leverage cache,
# but we will gracefully fall back to `npm install` if `npm ci` detects a mismatch.
COPY project/package.json ./
COPY project/package-lock.json ./

# Install production dependencies only. Prefer reproducible `npm ci`,
# but if lockfile is out-of-sync, fall back to `npm install --omit=dev`.
RUN npm ci --omit=dev \
	|| (echo "[warn] npm ci failed; falling back to npm install --omit=dev" \
			&& rm -f package-lock.json \
			&& npm install --omit=dev)

# Copy the rest of the project sources
COPY project/. ./

# Environment
ENV NODE_ENV=${NODE_ENV}
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server (path stable now)
CMD ["node", "server/index.js"]
