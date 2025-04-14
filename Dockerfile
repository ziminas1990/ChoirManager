# Image for building and bundling application:
FROM node:18 AS builder

WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY build.js ./
COPY src ./src

RUN npm install && npm run build-app

# Minimal runtime image:
FROM node:18-slim

# App lives here
WORKDIR /app

# Copy compiled and bundled file from builder
COPY --from=builder /app/dist/app.cjs ./app.cjs

# Optionally link config dir (your original intent)
RUN npm install request && ln -s /mnt/config ./config

# Run app and pipe logs
CMD ["sh", "-c", "node app.cjs | tee -a /mnt/logs/bot.log"]
