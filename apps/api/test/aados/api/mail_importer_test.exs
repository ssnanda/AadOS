defmodule AadOS.Api.Mail.ImporterTest do
  use ExUnit.Case, async: true
  alias AadOS.Api.Mail.Importer

  @export %{
    "accounts" => [
      %{"id" => "gmail-a", "provider" => "gmail", "email" => "a@x.com", "remoteId" => ""},
      %{"id" => "zoho-a", "provider" => "zoho", "email" => "z@x.com", "remoteId" => "99"},
      %{"id" => "bad", "provider" => "outlook", "email" => "o@x.com"}
    ],
    "pipelines" => [%{"id" => "inbox-gmail-a", "system" => true}, %{"id" => "shop", "system" => false}],
    "items" => [
      %{"pipelineId" => "inbox-gmail-a", "accountId" => "gmail-a", "messageId" => "m1", "subject" => "Hi", "receivedAt" => "2026-11-10T10:00:00Z", "unread" => true, "threadId" => "t1"},
      %{"pipelineId" => "shop", "accountId" => "gmail-a", "messageId" => "m1", "subject" => "Hi", "receivedAt" => "2026-11-10T10:00:00Z", "unread" => true, "seen" => true},
      %{"pipelineId" => "inbox-gmail-a", "accountId" => "zoho-a", "messageId" => "m1", "subject" => "Other account"},
      %{"pipelineId" => "x", "accountId" => "removed-account", "messageId" => "m9"}
    ]
  }

  test "rows are deduplicated per account and message, never merged across accounts" do
    %{accounts: accounts, messages: messages, memberships: memberships} = Importer.rows(@export)
    assert Enum.map(accounts, & &1.id) == ["gmail-a", "zoho-a"]
    assert length(messages) == 2
    assert Enum.map(messages, & &1.account_id) |> Enum.sort() == ["gmail-a", "zoho-a"]
    assert memberships[{"gmail-a", "m1"}] == ["shop"]
  end

  test "opened-in-AadOS copy marks the message read; thread id is kept; orphans are skipped" do
    %{messages: messages} = Importer.rows(@export)
    m = Enum.find(messages, &(&1.account_id == "gmail-a"))
    assert m.unread == false
    assert m.thread_id == "t1"
    refute Enum.any?(messages, &(&1.provider_message_id == "m9"))
  end

  test "export contains no credential fields" do
    refute inspect(Importer.rows(@export)) =~ "token"
  end
end
