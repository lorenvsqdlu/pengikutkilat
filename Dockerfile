FROM node:22-alpine

WORKDIR /app

# Install native dependencies for Prisma and other build tools if necessary
RUN apk add --no-cache openssl python3 make g++

COPY package*.json ./
RUN npm install

COPY . .

# Generate prisma client
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"]
