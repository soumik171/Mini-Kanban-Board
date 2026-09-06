# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/prisma ./prisma
COPY backend/src ./src
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# package.json carries the prisma seed config + scripts used by db seed.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 4000
# Schema changes apply automatically (migrate deploy). The seed is idempotent:
# it fills in demo users/boards and tops the demo board up to five columns when
# they are missing, and never deletes or duplicates user-created data - so a
# fresh database (or an old one) is brought up to date on every deploy.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/index.js"]
