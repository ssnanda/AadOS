defmodule AadOS.Api.Plugs.ServiceAuth do
  @moduledoc """
  Bearer-token authentication for internal APIs (web app -> Phoenix).
  Fails closed: with no `AADOS_INTERNAL_API_TOKEN` of at least 32 characters, every request is rejected.
  """
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  def init(opts), do: opts

  def call(conn, _opts) do
    expected = System.get_env("AADOS_INTERNAL_API_TOKEN", "")

    with true <- byte_size(expected) >= 32,
         ["Bearer " <> given] <- get_req_header(conn, "authorization"),
         true <- Plug.Crypto.secure_compare(given, expected) do
      conn
    else
      _ -> conn |> put_status(401) |> json(%{error: "unauthorized"}) |> halt()
    end
  end
end
