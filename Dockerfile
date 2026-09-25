FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm start"]
