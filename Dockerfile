# Cloud Run container for the Node.js API using project/ as build context
# Place this Dockerfile in the project/ folder and set Cloud Run to use this path.

FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package manifests first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev || npm ci --only=production

# Copy the rest of the sources (server, public, scripts, etc.)
COPY . ./

# Environment
ENV NODE_ENV=production
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server
CMD ["node", "server/index.js"]
