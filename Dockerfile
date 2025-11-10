## Cloud Run container for Node.js API when build CONTEXT is the REPO ROOT (Dockerfile in project/)
## This version explicitly copies the project/ subfolder so CMD can find server/index.js at /app/project/server/index.js.

FROM node:20-alpine

# Root workdir for staging copy
WORKDIR /app

# Copy only manifests first (from build context root) for layer caching
COPY project/package*.json ./project/

# Switch to project folder to install dependencies
WORKDIR /app/project

# Install production dependencies (tolerate unsynced lockfile). Later prefer: npm ci --omit=dev
RUN npm install --omit=dev --no-audit --no-fund

# Copy application source (only project subtree)
COPY project/ /app/project/

# Environment
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Explicit path after changing WORKDIR above
CMD ["node", "server/index.js"]
