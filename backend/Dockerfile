FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng ca-certificates gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package.json server.mjs engine.mjs same.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["sh","-c","chown -R node:node /data && exec gosu node node server.mjs"]
