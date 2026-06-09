FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
WORKDIR /app/EmailFunction
COPY EmailFunction/ ./
EXPOSE 3000
CMD ["node", "server.js"]
