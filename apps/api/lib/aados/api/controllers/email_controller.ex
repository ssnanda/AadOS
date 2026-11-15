defmodule AadOS.Api.Controllers.EmailController do
  @moduledoc "Read-only contract before provider connectors are enabled."
  use Phoenix.Controller, formats: [:json]

  def overview(conn, _params) do
    json(conn, %{
      connection_state: "not_connected",
      read_only: true,
      accounts: [],
      counts: %{all: 0, unread: 0, needs_reply: 0, important: 0},
      features: %{gmail: false, microsoft: false, ai_triage: false}
    })
  end

  def accounts(conn, _params) do
    json(conn, %{accounts: [], connection_state: "not_connected"})
  end

  def messages(conn, _params) do
    json(conn, %{messages: [], next_cursor: nil, connection_state: "not_connected"})
  end
end
