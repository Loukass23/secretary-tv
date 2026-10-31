# Secretary server, for hosting it on the internet (docs/hosting.md). The server and core have no npm dependencies, so
# nothing is installed: a symlink stands in for the pnpm workspace link, and Node strips the TypeScript as it runs.
FROM node:22-slim

WORKDIR /app
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/server/package.json packages/server/
COPY packages/server/src packages/server/src
RUN mkdir -p node_modules/@secretary /data \
  && ln -s ../../packages/core node_modules/@secretary/core \
  && chown node:node /data

USER node
# SECRETARY_HOSTED makes SERVER_KEY required: without it every route would be open to the internet.
ENV NODE_ENV=production PORT=7000 STATE_FILE=/data/secretary-state.json SECRETARY_HOSTED=1
EXPOSE 7000
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "packages/server/src/main.ts"]
