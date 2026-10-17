FROM node:20-bookworm-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application source code
COPY . .

# Render exposes PORT dynamically (default 10000)
ENV PORT=10000
EXPOSE 10000

# Start Elite Web server
CMD ["node", "server.js"]
