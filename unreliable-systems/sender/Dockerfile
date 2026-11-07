FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --omit=optional
COPY src ./src
CMD ["node", "src/main.js"]
