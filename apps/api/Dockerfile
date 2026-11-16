FROM elixir:1.17-alpine AS base

FROM base AS build
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs ./
RUN mix deps.get --only prod && mix deps.compile
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
