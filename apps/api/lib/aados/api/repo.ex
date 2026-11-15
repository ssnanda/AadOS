defmodule AadOS.Api.Repo do
  use Ecto.Repo,
    otp_app: :aados_api,
    adapter: Ecto.Adapters.Postgres
end
