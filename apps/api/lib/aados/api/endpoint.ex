defmodule AadOS.Api.Endpoint do
  use Phoenix.Endpoint, otp_app: :aados_api

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]
  plug Plug.Parsers, parsers: [:urlencoded, :multipart, :json], pass: ["*/*"], json_decoder: Jason
  plug AadOS.Api.Router
end
