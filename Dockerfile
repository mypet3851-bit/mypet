# Cloud Run container for Node.js API (server lives under project/server)
# Uses Node 20 LTS on a small Alpine base image.
FROM node:20-alpine

# Create app directory and set working dir to the project subfolder
WORKDIR /app

# Copy package manifests first for better layer caching
COPY project/package*.json ./project/

# Install production dependencies only
WORKDIR /app/project
RUN npm ci --omit=dev || npm ci --only=production

# Copy the rest of the project sources
COPY project/ /app/project/

# Environment
ENV NODE_ENV=production
# Cloud Run provides $PORT; default to 8080 for local runs
ENV PORT=8080

# Expose container port (for documentation; Cloud Run maps it)
EXPOSE 8080

# Start the API server
CMD ["node", "server/index.js"]
