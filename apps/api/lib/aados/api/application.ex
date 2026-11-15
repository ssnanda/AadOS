defmodule AadOS.Api.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    db_children =
      if System.get_env("AADOS_ENABLE_DATABASE", "false") == "true" do
        [AadOS.Api.Repo, {Oban, repo: AadOS.Api.Repo, queues: [default: 5]}]
      else
        []
      end

    children =
      [
        {Phoenix.PubSub, name: AadOS.Api.PubSub}
      ] ++ db_children ++ [AadOS.Api.Endpoint]

    Supervisor.start_link(children, strategy: :one_for_one, name: AadOS.Api.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    AadOS.Api.Endpoint.config_change(changed, removed)
    :ok
  end
end
