ARG SOURCE_IMAGE
FROM ${SOURCE_IMAGE}
USER root
COPY package.json package-lock.json /rehearsal-deps/
RUN npm ci --prefix /rehearsal-deps --omit=dev --ignore-scripts && npm cache clean --force
COPY guard.mjs api-preload.mjs pg-stub-preload.mjs cloud-capacity.mjs cloud-ops.mjs cloud-profile.mjs payment-return-policy.mjs /app/rehearsal/
USER nestjs
CMD ["node", "--max-old-space-size=256", "--import=/app/rehearsal/api-preload.mjs", "dist/main.js"]
