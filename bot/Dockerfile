FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js .

# Temp dir for audio file downloads before sending
RUN mkdir -p /tmp

ENV NODE_ENV=production

CMD ["node", "index.js"]
