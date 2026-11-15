import Config

port = String.to_integer(System.get_env("PORT", "4000"))
secret = System.get_env("SECRET_KEY_BASE")

if config_env() != :test and (is_nil(secret) or byte_size(secret) < 64) do
  raise "SECRET_KEY_BASE must be set to at least 64 characters"
end

config :aados_api, AadOS.Api.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: port],
  server: config_env() != :test,
  url: [host: System.get_env("PHX_HOST", "localhost")],
  secret_key_base: secret || String.duplicate("t", 64)

if System.get_env("AADOS_ENABLE_DATABASE", "false") == "true" do
  url = System.fetch_env!("DATABASE_URL")

  config :aados_api, AadOS.Api.Repo,
    url: url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE", "5"))
end
