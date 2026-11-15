defmodule AadOS.Api.RouterTest do
  use ExUnit.Case, async: true
  use Plug.Test

  test "health endpoint responds" do
    conn = conn(:get, "/api/health") |> AadOS.Api.Router.call(AadOS.Api.Router.init([]))
    assert conn.status == 200
    assert Jason.decode!(conn.resp_body)["status"] == "ok"
  end

  test "email endpoints never fabricate or mutate mail" do
    conn = conn(:get, "/api/v1/email/overview") |> AadOS.Api.Router.call(AadOS.Api.Router.init([]))
    payload = Jason.decode!(conn.resp_body)
    assert conn.status == 200
    assert payload["connection_state"] == "not_connected"
    assert payload["read_only"] == true
    assert payload["counts"]["unread"] == 0
    assert payload["accounts"] == []

    conn = conn(:get, "/api/v1/email/messages") |> AadOS.Api.Router.call(AadOS.Api.Router.init([]))
    assert Jason.decode!(conn.resp_body)["messages"] == []
  end
end
