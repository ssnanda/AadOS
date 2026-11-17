import Config

config :aados_api, AadOS.Api.Endpoint,
  debug_errors: false,
  code_reloader: false

# Privacy: no debug/SQL logging in releases (query parameters can contain personal data such as email addresses).
config :logger, level: :info
