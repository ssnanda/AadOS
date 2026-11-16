defmodule Mix.Tasks.Aados.ImportState do
  @shortdoc "Import a redacted AadOS state export (JSON) into PostgreSQL"
  @moduledoc """
  mix aados.import_state path/to/export.json

  Requires AADOS_ENABLE_DATABASE=true and DATABASE_URL. Idempotent and additive; never touches state.enc.
  """
  use Mix.Task

  @impl true
  def run([path]) do
    Mix.Task.run("app.config")
    {:ok, _} = Application.ensure_all_started(:ecto_sql)
    {:ok, _} = Application.ensure_all_started(:postgrex)
    {:ok, _} = AadOS.Api.Repo.start_link()

    export = path |> File.read!() |> Jason.decode!()
    expected = %{accounts: length(export["accounts"]), source_messages: length(export["items"])}

    case AadOS.Api.Mail.Importer.import_export(export) do
      {:ok, counts} -> Mix.shell().info("imported #{inspect(counts)} (export had #{inspect(expected)})")
      {:error, reason} -> Mix.raise("import rolled back: #{inspect(reason)}")
    end
  end

  def run(_), do: Mix.raise("usage: mix aados.import_state path/to/export.json")
end
