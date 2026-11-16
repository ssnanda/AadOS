defmodule AadOS.Api.Controllers.InternalController do
  @moduledoc """
  Authenticated (service token) read-only API over the PostgreSQL mail tables. Never returns credentials.
  Used by the web app for dual-read comparison; every action fails with 503 while the database is disabled.
  """
  use Phoenix.Controller, formats: [:json]
  import Ecto.Query
  alias AadOS.Api.Repo

  plug :require_database

  def summary(conn, _params) do
    json(conn, %{
      accounts: Repo.aggregate("mail_accounts", :count),
      messages: Repo.aggregate("mail_messages", :count),
      unread: Repo.aggregate(from(m in "mail_messages", where: m.unread == true), :count),
      tasks: Repo.aggregate("mail_tasks", :count),
      per_account: per_account()
    })
  end

  def accounts(conn, _params) do
    rows =
      Repo.all(
        from a in "mail_accounts",
          order_by: a.id,
          select: %{id: a.id, provider: a.provider, email: a.email, paused: a.paused, last_sync_at: a.last_sync_at, last_error: a.last_error}
      )

    json(conn, %{accounts: rows})
  end

  @doc "Filters: account, q (full text), unread=true|false, category, limit (<=200), offset."
  def messages(conn, params) do
    limit = params |> Map.get("limit", "50") |> to_int(50) |> min(200) |> max(1)
    offset = params |> Map.get("offset", "0") |> to_int(0) |> max(0)

    base =
      from m in "mail_messages",
        order_by: [desc: m.received_at, asc: m.id]

    base =
      base
      |> filter_account(params["account"])
      |> filter_text(params["q"])
      |> filter_unread(params["unread"])
      |> filter_category(params["category"])

    total = Repo.aggregate(exclude(base, :order_by), :count)

    rows =
      Repo.all(
        from m in base,
          limit: ^limit,
          offset: ^offset,
          select: %{
            id: m.id, account_id: m.account_id, provider_message_id: m.provider_message_id, thread_id: m.thread_id,
            subject: m.subject, sender: m.sender, summary: m.summary, received_at: m.received_at, unread: m.unread,
            kind: m.kind, categories: m.categories, importance: m.importance, action_state: m.action_state
          }
      )

    json(conn, %{total: total, limit: limit, offset: offset, messages: rows})
  end

  defp filter_account(query, id) when is_binary(id) and id != "", do: where(query, [m], m.account_id == ^id)
  defp filter_account(query, _), do: query

  defp filter_text(query, q) when is_binary(q) and q != "",
    do: where(query, [m], fragment("? @@ plainto_tsquery('simple', ?)", m.search, ^q))

  defp filter_text(query, _), do: query

  defp filter_unread(query, "true"), do: where(query, [m], m.unread == true)
  defp filter_unread(query, "false"), do: where(query, [m], m.unread == false)
  defp filter_unread(query, _), do: query

  defp filter_category(query, c) when is_binary(c) and c != "", do: where(query, [m], ^c in m.categories)
  defp filter_category(query, _), do: query

  defp per_account do
    Repo.all(from m in "mail_messages", group_by: m.account_id, select: {m.account_id, count(m.id)}) |> Map.new()
  end

  defp to_int(value, default) do
    case Integer.parse(to_string(value)) do
      {n, ""} -> n
      _ -> default
    end
  end

  defp require_database(conn, _opts) do
    if System.get_env("AADOS_ENABLE_DATABASE", "false") == "true" or Process.whereis(AadOS.Api.Repo) do
      conn
    else
      conn |> put_status(503) |> json(%{error: "database_disabled"}) |> halt()
    end
  end
end
