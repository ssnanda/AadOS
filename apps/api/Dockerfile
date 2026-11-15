FROM elixir:1.17-alpine AS build
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs ./
RUN mix deps.get --only prod && mix deps.compile
COPY config ./config
COPY lib ./lib
RUN mix compile && mix release

FROM alpine:3.20
RUN apk add --no-cache libstdc++ openssl ncurses-libs && addgroup -S aados && adduser -S aados -G aados
WORKDIR /app
COPY --from=build --chown=aados:aados /app/_build/prod/rel/aados_api ./
USER aados
ENV HOME=/app PORT=4000
EXPOSE 4000
CMD ["bin/aados_api", "start"]
