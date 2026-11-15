import Config

config :aados_api,
  ecto_repos: [AadOS.Api.Repo]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
