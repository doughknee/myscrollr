# Build context: monorepo root (Coolify deploys from repo root)

# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY myscrollr.com/package.json myscrollr.com/package-lock.json* ./myscrollr.com/

# Install dependencies
WORKDIR /app/myscrollr.com
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# Copy the rest of the frontend source
WORKDIR /app
COPY myscrollr.com/ ./myscrollr.com/

# Accept build-time env vars
ARG VITE_API_URL
ARG VITE_LOGTO_ENDPOINT
ARG VITE_LOGTO_APP_ID
ARG VITE_LOGTO_RESOURCE
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_STRIPE_PRICE_MONTHLY
ARG VITE_STRIPE_PRICE_ANNUAL
ARG VITE_STRIPE_PRICE_PRO_MONTHLY
ARG VITE_STRIPE_PRICE_PRO_ANNUAL
ARG VITE_STRIPE_PRICE_ULTIMATE_MONTHLY
ARG VITE_STRIPE_PRICE_ULTIMATE_ANNUAL
# Sentry — VITE_SENTRY_DSN is baked into the bundle. SENTRY_AUTH_TOKEN
# and SENTRY_ORG are read by @sentry/vite-plugin to upload source maps
# during the build. If unset, the plugin disables itself (no upload).
ARG VITE_SENTRY_DSN
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_LOGTO_ENDPOINT=${VITE_LOGTO_ENDPOINT}
ENV VITE_LOGTO_APP_ID=${VITE_LOGTO_APP_ID}
ENV VITE_LOGTO_RESOURCE=${VITE_LOGTO_RESOURCE}
ENV VITE_STRIPE_PUBLISHABLE_KEY=${VITE_STRIPE_PUBLISHABLE_KEY}
ENV VITE_STRIPE_PRICE_MONTHLY=${VITE_STRIPE_PRICE_MONTHLY}
ENV VITE_STRIPE_PRICE_ANNUAL=${VITE_STRIPE_PRICE_ANNUAL}
ENV VITE_STRIPE_PRICE_PRO_MONTHLY=${VITE_STRIPE_PRICE_PRO_MONTHLY}
ENV VITE_STRIPE_PRICE_PRO_ANNUAL=${VITE_STRIPE_PRICE_PRO_ANNUAL}
ENV VITE_STRIPE_PRICE_ULTIMATE_MONTHLY=${VITE_STRIPE_PRICE_ULTIMATE_MONTHLY}
ENV VITE_STRIPE_PRICE_ULTIMATE_ANNUAL=${VITE_STRIPE_PRICE_ULTIMATE_ANNUAL}
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ENV SENTRY_ORG=${SENTRY_ORG}
ENV SKIP_MOBILE_VIEWPORT_CHECK=1

# Build (vite build + tsc)
WORKDIR /app/myscrollr.com
RUN npm run build

# ── Stage 2: Serve ──────────────────────────────────────────────
FROM nginx:alpine

# Copy built assets to nginx
COPY --from=builder /app/myscrollr.com/dist/client /usr/share/nginx/html

# SPA fallback: route all paths to index.html for client-side routing
# Includes security headers, gzip compression, and proper caching
RUN printf 'server {\n\
    listen 3000;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    # ── Redirect-leak guards ────────────────────────────────────\n\
    # Without these, nginx builds Location headers using its own\n\
    # listen port (3000) and the inbound scheme (http, since TLS\n\
    # is terminated at the k8s ingress). That produced redirects\n\
    # like "http://myscrollr.com:3000/uplink/" — port-leaked,\n\
    # scheme-downgraded, and unreachable from the public edge.\n\
    # absolute_redirect off  -> emit relative Location ("/uplink/")\n\
    #                          which clients resolve against the\n\
    #                          original request URL (preserving\n\
    #                          https + correct host).\n\
    # port_in_redirect off   -> belt + suspenders: never include\n\
    #                          ":3000" in any Location header.\n\
    absolute_redirect off;\n\
    port_in_redirect off;\n\
\n\
    # ── Security headers (server-level) ─────────────────────────\n\
    # NOTE: nginx add_header in a child location block overrides\n\
    # ALL parent add_header directives. To work around this, we\n\
    # use an include file for shared security headers.\n\
\n\
    # ── Gzip compression ────────────────────────────────────────\n\
    gzip on;\n\
    gzip_vary on;\n\
    gzip_proxied any;\n\
    gzip_comp_level 6;\n\
    gzip_min_length 256;\n\
    gzip_types\n\
        text/plain\n\
        text/css\n\
        text/javascript\n\
        application/javascript\n\
        application/json\n\
        application/xml\n\
        image/svg+xml\n\
        font/woff2;\n\
\n\
    # ── Sentry tunnel: same-origin proxy avoids browser blocking ─\n\
    location = /api/sentry-envelope {\n\
        proxy_pass https://o4511384091033600.ingest.us.sentry.io/api/4511384375132160/envelope/;\n\
        proxy_ssl_server_name on;\n\
        proxy_pass_request_headers off;\n\
        proxy_set_header Host o4511384091033600.ingest.us.sentry.io;\n\
        proxy_set_header Content-Type $content_type;\n\
        proxy_set_header Content-Length $content_length;\n\
    }\n\
\n\
    # ── HTML: no-cache so users always get latest deploy ────────\n\
    # try_files order matters:\n\
    #   1. $uri              — exact file (e.g. /robots.txt, /sitemap.xml)\n\
    #   2. $uri/index.html   — prerendered route (e.g. /uplink ->\n\
    #                          /uplink/index.html). Serves the file\n\
    #                          DIRECTLY at 200. This avoids the built-in\n\
    #                          "$uri/" directory match, which would have\n\
    #                          issued a 301 to add a trailing slash —\n\
    #                          the source of the original redirect leak\n\
    #                          and a mismatch with our canonical URLs\n\
    #                          (sitemap + <link rel=canonical> declare\n\
    #                          /uplink, not /uplink/).\n\
    #   3. /index.html       — SPA fallback for dynamic routes\n\
    #                          (/account, /callback, /u/$username, etc.)\n\
    location / {\n\
        include /etc/nginx/security-headers.conf;\n\
        add_header Cache-Control "no-cache";\n\
        try_files $uri $uri/index.html /index.html;\n\
    }\n\
\n\
    # ── Hashed static assets: cache forever ─────────────────────\n\
    location /assets/ {\n\
        include /etc/nginx/security-headers.conf;\n\
        expires 1y;\n\
        add_header Cache-Control "public, max-age=31536000, immutable";\n\
    }\n\
\n\
    # ── Fonts: long cache ───────────────────────────────────────\n\
    location ~* \\.woff2?$ {\n\
        include /etc/nginx/security-headers.conf;\n\
        expires 1y;\n\
        add_header Cache-Control "public, max-age=31536000, immutable";\n\
        add_header Access-Control-Allow-Origin "*";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf && \
printf 'add_header X-Content-Type-Options "nosniff" always;\n\
add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;\n\
add_header Content-Security-Policy "default-src '"'"'self'"'"'; frame-ancestors '"'"'self'"'"' https://relentnet.com; script-src '"'"'self'"'"' '"'"'unsafe-inline'"'"' https://js.stripe.com; style-src '"'"'self'"'"' '"'"'unsafe-inline'"'"'; img-src '"'"'self'"'"' data: https:; font-src '"'"'self'"'"'; connect-src '"'"'self'"'"' https://api.myscrollr.com https://auth.myscrollr.com https://api.stripe.com https://api.github.com; frame-src https://js.stripe.com https://hooks.stripe.com; base-uri '"'"'self'"'"'; form-action '"'"'self'"'"';" always;\n\
' > /etc/nginx/security-headers.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
