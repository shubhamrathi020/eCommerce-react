# One image per app. Each is a static single-page app served by nginx. Build from the repository root:
#   docker build --build-arg APP=storefront -t shop-react-storefront .
#   docker build --build-arg APP=admin      -t shop-react-admin .
#   docker build --build-arg APP=seller     -t shop-react-seller .
# VITE_BACKEND picks the API the bundle talks to (mock | nest | go | node | dotnet); VITE_API_BASE_URL overrides its address. Both are baked
# in when the bundle is built, because a static site has no server-side configuration.

ARG APP=storefront

FROM node:22-alpine AS build
ARG APP
ARG VITE_BACKEND=go
ARG VITE_API_BASE_URL=
ARG VITE_STOREFRONT_URL=
ENV VITE_BACKEND=$VITE_BACKEND VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_STOREFRONT_URL=$VITE_STOREFRONT_URL
WORKDIR /app
# git: the shared contracts package is installed from GitHub.
RUN apk add --no-cache git && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @shop/${APP} build

# The nginx template with this app's Content-Security-Policy filled in. Only the storefront takes payments, so only it may
# load Razorpay's checkout (its script, its frame, its API and its images); the admin and seller apps stay locked down.
# Checkout.js loads a second script from cdn.razorpay.com (its fraud check); a production run showed it blocked without it.
COPY nginx/default.conf.template /tmp/default.conf.template
RUN if [ "$APP" = "storefront" ]; then \
      sed -i -e 's|@PAY_SCRIPT@| https://checkout.razorpay.com https://cdn.razorpay.com|' \
             -e 's|@PAY_IMG@| https://cdn.razorpay.com|' \
             -e 's|@PAY_CONNECT@| https://api.razorpay.com https://lumberjack.razorpay.com|' \
             -e 's|@PAY_FRAME@| https://api.razorpay.com https://checkout.razorpay.com|' /tmp/default.conf.template; \
    else \
      sed -i -e 's|@PAY_[A-Z]*@||g' /tmp/default.conf.template; \
    fi

# nginx-unprivileged runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ARG APP
# Files in /etc/nginx/templates are run through envsubst at start-up, so the Content-Security-Policy can name the API origin.
ENV API_ORIGIN=http://localhost:3334
COPY --from=build /tmp/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/${APP}/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
