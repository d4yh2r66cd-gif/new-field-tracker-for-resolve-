FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000 DB_FILE=/data/fieldtrack.db UPLOAD_DIR=/data/uploads
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
