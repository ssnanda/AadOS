FROM elixir:1.17-alpine AS base

FROM base AS build
WORKDIR /app
ENV MIX_ENV=prod \
    HEX_HTTP_TIMEOUT=180 \
    HEX_HTTP_CONCURRENCY=2
# OpenShift's build pod can have brief outbound stalls. Give each download a longer
# timeout and three bounded attempts instead of failing the whole release on one miss.
RUN set -e; \
    attempt=1; \
    until mix local.hex --force; do \
      [ "$attempt" -ge 3 ] && exit 1; \
      attempt=$((attempt + 1)); sleep 5; \
    done; \
    attempt=1; \
    until mix local.rebar --force; do \
      [ "$attempt" -ge 3 ] && exit 1; \
      attempt=$((attempt + 1)); sleep 5; \
    done
COPY mix.exs ./
COPY mix.lock ./
RUN set -e; \
    attempt=1; \
    until mix deps.get --only prod; do \
      [ "$attempt" -ge 3 ] && exit 1; \
      attempt=$((attempt + 1)); sleep 5; \
    done; \
    mix deps.compile
COPY config ./config
COPY lib ./lib
COPY priv ./priv
RUN mix compile && mix release

FROM base AS runtime
RUN addgroup -S aados && adduser -S aados -G aados
WORKDIR /app
COPY --from=build --chown=aados:aados /app/_build/prod/rel/aados_api ./
USER aados
ENV HOME=/app PORT=4000
EXPOSE 4000
CMD ["bin/aados_api", "start"]
