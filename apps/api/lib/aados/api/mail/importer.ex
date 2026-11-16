defmodule AadOS.Api.Mail.Importer do
  @moduledoc """
  One-way, idempotent import of a redacted AadOS state export (see `apps/web/scripts/state-tool.mjs export`)
  into PostgreSQL. It never reads or writes the encrypted state file, never receives OAuth tokens, and only
  inserts/updates rows, so it is safe to re-run. Rollback = drop the `mail_*` tables; the state file is untouched.
  """
  alias AadOS.Api.Repo

  @batch 500

  @doc "Pure mapping from an export map to row lists (no database access)."
  def rows(%{"accounts" => accounts, "items" => items} = export) do
    pipelines = Map.get(export, "pipelines", [])
    system_ids = for p <- pipelines, p["system"] == true, into: MapSet.new(), do: p["id"]
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    account_rows =
      for a <- accounts, a["provider"] in ["gmail", "zoho"] do
        %{id: a["id"], provider: a["provider"], email: a["email"] || "", remote_id: a["remoteId"] || "",
          paused: a["paused"] == true, last_sync_at: parse_time(a["lastSync"]), last_error: blank_to_nil(a["lastError"]),
          inserted_at: now, updated_at: now}
      end

    known = MapSet.new(account_rows, & &1.id)

    # Collapse copies of the same source message (several views/labels) into one row keyed by account + provider id.
    grouped =
      items
      |> Enum.filter(&(is_binary(&1["accountId"]) and MapSet.member?(known, &1["accountId"]) and is_binary(&1["messageId"])))
      |> Enum.group_by(&{&1["accountId"], &1["messageId"]})

    {message_rows, memberships} =
      Enum.map_reduce(grouped, [], fn {{account_id, message_id}, copies}, acc ->
        first = Enum.find(copies, hd(copies), & &1["folderId"])
        merged = fn key -> Enum.find_value(copies, & &1[key]) end

        row = %{
          account_id: account_id, provider_message_id: message_id, thread_id: merged.("threadId"),
          subject: first["subject"] || "", sender: first["sender"] || "", summary: first["summary"] || "",
          received_at: parse_time(first["receivedAt"]),
          unread: not Enum.any?(copies, & &1["seen"]) and Enum.all?(copies, &(&1["unread"] != false)),
          kind: first["kind"] || "other", facts: first["facts"] || %{}, categories: merged.("categories") || [],
          importance: merged.("importance"), action_state: merged.("actionState"),
          follow_up_at: parse_time(merged.("followUp")), inserted_at: now, updated_at: now
        }

        views = for c <- copies, not MapSet.member?(system_ids, c["pipelineId"]), uniq: true, do: c["pipelineId"]
        {row, [{{account_id, message_id}, views} | acc]}
      end)

    %{accounts: account_rows, messages: message_rows, memberships: Map.new(memberships)}
  end

  @doc "Import inside one transaction. Returns `{:ok, counts}`; counts can be compared with `state-tool verify`."
  def import_export(export) do
    %{accounts: accounts, messages: messages, memberships: memberships} = rows(export)

    Repo.transaction(fn ->
      Enum.each(Enum.chunk_every(accounts, @batch), fn chunk ->
        Repo.insert_all("mail_accounts", chunk, on_conflict: {:replace, [:email, :remote_id, :paused, :last_sync_at, :last_error, :updated_at]}, conflict_target: [:id])
      end)

      Enum.each(Enum.chunk_every(messages, @batch), fn chunk ->
        Repo.insert_all("mail_messages", chunk,
          on_conflict: {:replace, [:thread_id, :subject, :sender, :summary, :received_at, :unread, :kind, :facts, :categories, :importance, :action_state, :follow_up_at, :updated_at]},
          conflict_target: [:account_id, :provider_message_id]
        )
      end)

      ids = Repo.query!("SELECT id, account_id, provider_message_id FROM mail_messages").rows
      id_by_key = Map.new(ids, fn [id, account, pid] -> {{account, pid}, id} end)

      view_rows = for {key, views} <- memberships, id = id_by_key[key], not is_nil(id), v <- views, do: %{message_id: id, view_id: v}

      Enum.each(Enum.chunk_every(view_rows, @batch), fn chunk ->
        Repo.insert_all("mail_message_views", chunk, on_conflict: :nothing)
      end)

      counts()
    end)
  end

  def counts do
    %{
      accounts: Repo.aggregate("mail_accounts", :count),
      messages: Repo.aggregate("mail_messages", :count),
      view_memberships: Repo.aggregate("mail_message_views", :count)
    }
  end

  defp parse_time(value) when is_binary(value) and value != "" do
    case DateTime.from_iso8601(value) do
      {:ok, dt, _} -> DateTime.truncate(dt, :second)
      _ -> nil
    end
  end

  defp parse_time(_), do: nil
  defp blank_to_nil(value) when value in [nil, ""], do: nil
  defp blank_to_nil(value), do: value
end
