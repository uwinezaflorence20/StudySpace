FROM node:18-alpine

WORKDIR /app

ENV CHOKIDAR_USEPOLLING=true

COPY package.json .
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
