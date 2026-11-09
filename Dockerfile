FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY packages ./packages
COPY apps ./apps

CMD ["npm", "run", "start:api"]
