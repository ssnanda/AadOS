defmodule AadOS.Api.Migrator do
  @moduledoc """
  Runs pending Ecto migrations synchronously while the supervision tree starts (after the Repo, before Oban and the
  endpoint), so the web app never sees a half-migrated database. Migrations are additive and idempotent.
  A failure crashes the start-up on purpose: the API must not serve with a broken schema.
  """
  require Logger

  def child_spec(_opts), do: %{id: __MODULE__, start: {__MODULE__, :start_link, []}, restart: :temporary}

  def start_link do
    versions = Ecto.Migrator.run(AadOS.Api.Repo, :up, all: true, log: false)
    Logger.info("aados migrations applied: #{inspect(versions)}")
    :ignore
  end
end
