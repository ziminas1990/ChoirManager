FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

COPY package*.json ./
COPY src ./src
COPY files ./files
COPY tsconfig.json ./tsconfig.json

# Setting up the environment
RUN apt update && \
    apt install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt install -y nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    ln -s /mnt/config ./config

# Building the application
RUN npm install && npm run compile

CMD ["npm", "run", "bot"]
