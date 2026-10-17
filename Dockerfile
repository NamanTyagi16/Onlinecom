FROM node:20-bookworm-slim

# Step 1: Install required dependencies & download ttyd (Web Terminal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    bash \
    && curl -LO https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.x86_64 \
    && chmod +x ttyd.x86_64 \
    && mv ttyd.x86_64 /usr/local/bin/ttyd \
    && rm -rf /var/lib/apt/lists/*

# Step 2: Install autocannon globally
RUN npm install -g autocannon

# Step 3: Create a normal user (safety ke liye taaki root se shell na chale)
RUN useradd -m -s /bin/bash appuser
USER appuser
WORKDIR /home/appuser

# Render dynamically assigns a PORT (default 10000)
ENV PORT=10000
EXPOSE 10000

# Step 4: Run ttyd terminal
# -W allows writing (typing)
# -c allows Basic Auth username:password (environment variable se aayega)
CMD ["sh", "-c", "if [ -n \"$AUTH_USER\" ] && [ -n \"$AUTH_PASS\" ]; then ttyd -p ${PORT:-10000} -c ${AUTH_USER}:${AUTH_PASS} -W bash; else ttyd -p ${PORT:-10000} -W bash; fi"]
