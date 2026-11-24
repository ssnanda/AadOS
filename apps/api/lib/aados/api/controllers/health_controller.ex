defmodule AadOS.Api.Controllers.HealthController do
  use Phoenix.Controller, formats: [:json]

  def index(conn, _params) do
    json(conn, %{status: "ok", service: "aados-api", version: "0.1.102"})
  end
end
