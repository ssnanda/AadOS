defmodule AadOS.Api.DbTest do
  @moduledoc "Integration tests against a real PostgreSQL (CI service). Tagged :db; excluded when no test database is configured."
  use ExUnit.Case, async: false
  use Plug.Test
  @moduletag :db

  alias AadOS.Api.{Repo, Vault}
  alias AadOS.Api.Mail.{Credentials, Importer}

  @token String.duplicate("t", 40)
  @key Base.encode64(:crypto.strong_rand_bytes(32))

  setup do
    System.put_env("AADOS_INTERNAL_API_TOKEN", @token)
    System.put_env("AADOS_CREDENTIAL_ENCRYPTION_KEY", @key)
    Repo.query!("TRUNCATE mail_message_views, mail_sync_checkpoints, mail_messages, mail_accounts, mail_tasks, mail_credentials, app_state CASCADE")

    on_exit(fn ->
      System.delete_env("AADOS_INTERNAL_API_TOKEN")
      System.delete_env("AADOS_CREDENTIAL_ENCRYPTION_KEY")
    end)

    :ok
  end

  defp export do
    %{
      "accounts" => [
        %{"id" => "gmail-a", "provider" => "gmail", "email" => "a@x.com"},
        %{"id" => "gmail-b", "provider" => "gmail", "email" => "b@x.com"}
      ],
      "pipelines" => [%{"id" => "inbox-gmail-a", "system" => true}, %{"id" => "shop", "system" => false}],
      "items" => [
        %{"pipelineId" => "inbox-gmail-a", "accountId" => "gmail-a", "messageId" => "m1", "subject" => "Electric bill due", "sender" => "Power Co", "summary" => "pay by Nov 30", "receivedAt" => "2026-11-10T10:00:00Z", "unread" => true, "threadId" => "t1"},
        %{"pipelineId" => "shop", "accountId" => "gmail-a", "messageId" => "m1", "subject" => "Electric bill due", "unread" => true},
        %{"pipelineId" => "inbox-gmail-a", "accountId" => "gmail-b", "messageId" => "m1", "subject" => "Holiday photos", "sender" => "Mom", "receivedAt" => "2026-11-11T10:00:00Z", "unread" => false}
      ],
      "tasks" => [%{"id" => "t1", "title" => "Pay bill", "due" => "2026-11-30", "priority" => "high", "done" => false}],
      "credentials" => %{"account:gmail-a" => %{"refreshToken" => "REFRESH-SECRET", "accessToken" => "ACCESS-SECRET"}}
    }
  end

  defp get(path) do
    # Through the endpoint so query-string params are parsed, as in production.
    conn(:get, path) |> put_req_header("authorization", "Bearer " <> @token) |> AadOS.Api.Endpoint.call([])
  end

  test "migrations are applied (tables exist)" do
    for table <- ~w(mail_accounts mail_messages mail_message_views mail_sync_checkpoints mail_credentials mail_tasks) do
      assert Repo.query!("SELECT to_regclass($1)::text", [table]).rows == [[table]]
    end
  end

  test "import is idempotent and deduplicates per account; identical ids in two accounts stay separate" do
    assert {:ok, first} = Importer.import_export(export())
    assert first.messages == 2 and first.accounts == 2 and first.view_memberships == 1 and first.tasks == 1
    assert {:ok, second} = Importer.import_export(export())
    assert second == first
  end

  test "concurrent imports do not corrupt or duplicate data" do
    results = 1..6 |> Task.async_stream(fn _ -> Importer.import_export(export()) end, max_concurrency: 6, timeout: 30_000) |> Enum.map(fn {:ok, r} -> r end)
    assert Enum.all?(results, &match?({:ok, _}, &1))
    assert Importer.counts().messages == 2
  end

  test "credentials are encrypted at rest and round-trip; wrong scope cannot decrypt" do
    {:ok, _} = Importer.import_export(export())
    [[version, iv, tag, ciphertext]] = Repo.query!("SELECT key_version, iv, tag, ciphertext FROM mail_credentials WHERE scope = 'account:gmail-a'").rows
    refute ciphertext =~ "REFRESH-SECRET"
    assert {:ok, %{"refreshToken" => "REFRESH-SECRET"}} = Credentials.get("account:gmail-a")
    {:ok, ring} = Vault.keyring()
    assert {:error, :authentication_failed} = Vault.decrypt("account:gmail-b", %{key_version: version, iv: iv, tag: tag, ciphertext: ciphertext}, ring)
    assert Credentials.get("account:none") == nil
  end

  test "key rotation re-encrypts rows onto the new key version" do
    {:ok, _} = Importer.import_export(export())
    {:ok, old_ring} = Vault.keyring()
    new_key = :crypto.strong_rand_bytes(32)
    {1, old_key} = old_ring.current
    both = %{current: {2, new_key}, ring: %{1 => old_key, 2 => new_key}}
    assert {:ok, 1} = Credentials.rotate(both)
    assert [[2]] = Repo.query!("SELECT key_version FROM mail_credentials").rows
    assert {:ok, %{"refreshToken" => "REFRESH-SECRET"}} = Credentials.get("account:gmail-a", both)
    assert {:ok, 0} = Credentials.rotate(both)
  end

  test "internal API: search, account isolation, pagination, no credentials leaked" do
    {:ok, _} = Importer.import_export(export())

    all = Jason.decode!(get("/internal/v1/messages").resp_body)
    assert all["total"] == 2

    hits = Jason.decode!(get("/internal/v1/messages?q=electric").resp_body)
    assert hits["total"] == 1 and hd(hits["messages"])["account_id"] == "gmail-a"

    only_b = Jason.decode!(get("/internal/v1/messages?account=gmail-b").resp_body)
    assert Enum.map(only_b["messages"], & &1["account_id"]) == ["gmail-b"]

    assert Jason.decode!(get("/internal/v1/messages?unread=true").resp_body)["total"] == 1
    assert length(Jason.decode!(get("/internal/v1/messages?limit=1&offset=1").resp_body)["messages"]) == 1

    summary = Jason.decode!(get("/internal/v1/summary").resp_body)
    assert summary["messages"] == 2 and summary["per_account"] == %{"gmail-a" => 1, "gmail-b" => 1}

    for path <- ["/internal/v1/messages", "/internal/v1/accounts", "/internal/v1/summary"] do
      refute get(path).resp_body =~ "SECRET"
    end
  end

  test "mirror refresh rebuilds the relational tables from the primary app_state document" do
    doc = %{
      "accounts" => [%{"id" => "gmail-a", "provider" => "gmail", "email" => "a@x.com", "accessToken" => "", "refreshToken" => ""}],
      "pipelines" => [%{"id" => "inbox-gmail-a", "accountId" => "gmail-a", "system" => true}],
      "items" => [%{"pipelineId" => "inbox-gmail-a", "messageId" => "m1", "subject" => "Legacy item without accountId", "unread" => true}],
      "tasks" => [%{"id" => "t1", "title" => "Pay", "priority" => "high", "done" => false}]
    }

    assert {:error, :no_state} = Importer.refresh_from_app_state()
    Repo.query!("INSERT INTO app_state (id, data, version, inserted_at, updated_at) VALUES (1, $1, 1, now(), now())", [doc])
    assert {:ok, %{messages: 1, accounts: 1, tasks: 1}} = Importer.refresh_from_app_state()
    assert {:ok, %{messages: 1}} = Importer.refresh_from_app_state()

    conn = conn(:post, "/internal/v1/mirror/refresh") |> put_req_header("authorization", "Bearer " <> @token) |> AadOS.Api.Endpoint.call([])
    assert conn.status == 200
    assert Jason.decode!(get("/internal/v1/messages?q=legacy").resp_body)["total"] == 1
    Repo.query!("TRUNCATE app_state")
  end

  test "no data without the token even with a database" do
    {:ok, _} = Importer.import_export(export())
    conn = conn(:get, "/internal/v1/messages") |> AadOS.Api.Router.call(AadOS.Api.Router.init([]))
    assert conn.status == 401
    refute conn.resp_body =~ "Electric"
  end

  test "rollback and re-apply of the mail migrations works (test database only)" do
    {:ok, _} = Importer.import_export(export())
    Ecto.Migrator.run(Repo, :down, all: true, log: false)
    assert Repo.query!("SELECT to_regclass('mail_messages')::text").rows == [[nil]]
    Ecto.Migrator.run(Repo, :up, all: true, log: false)
    assert Repo.query!("SELECT to_regclass('mail_messages')::text").rows == [["mail_messages"]]
  end
end
