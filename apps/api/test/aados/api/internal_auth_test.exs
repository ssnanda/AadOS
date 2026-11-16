defmodule AadOS.Api.InternalAuthTest do
  use ExUnit.Case, async: false
  use Plug.Test

  @token String.duplicate("t", 40)
  setup do
    on_exit(fn -> System.delete_env("AADOS_INTERNAL_API_TOKEN") end)
    :ok
  end

  defp call(path, token) do
    conn = conn(:get, path)
    conn = if token, do: put_req_header(conn, "authorization", "Bearer " <> token), else: conn
    AadOS.Api.Router.call(conn, AadOS.Api.Router.init([]))
  end

  test "fails closed when no token is configured" do
    System.delete_env("AADOS_INTERNAL_API_TOKEN")
    assert call("/internal/v1/summary", nil).status == 401
    assert call("/internal/v1/summary", "anything").status == 401
  end

  test "rejects missing, short and wrong tokens; accepts the right one" do
    System.put_env("AADOS_INTERNAL_API_TOKEN", @token)
    assert call("/internal/v1/messages", nil).status == 401
    assert call("/internal/v1/messages", String.duplicate("x", 40)).status == 401
    assert call("/internal/v1/messages", "short").status == 401
    # authenticated: 503 while no database is running (plain unit tests), 200 when the CI test database is up
    conn = call("/internal/v1/messages", @token)

    if Process.whereis(AadOS.Api.Repo) do
      assert conn.status == 200
    else
      assert conn.status == 503
      assert Jason.decode!(conn.resp_body)["error"] == "database_disabled"
    end
  end

  test "a short configured token is treated as unconfigured" do
    System.put_env("AADOS_INTERNAL_API_TOKEN", "short")
    assert call("/internal/v1/summary", "short").status == 401
  end
end
