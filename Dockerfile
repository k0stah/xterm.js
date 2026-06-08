FROM node:22-bookworm

WORKDIR /app

COPY . .

RUN npm ci \
  && npm run build \
  && npm run esbuild \
  && npm run esbuild-demo-client \
  && npm run esbuild-demo-server

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
