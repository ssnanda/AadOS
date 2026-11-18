defmodule AadOS.Api.MixProject do
  use Mix.Project

  def project do
    [
      app: :aados_api,
      version: "0.1.55",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      mod: {AadOS.Api.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:plug_cowboy, "~> 2.7"},
      {:jason, "~> 1.4"},
      {:ecto_sql, "~> 3.12"},
      {:postgrex, "~> 0.20"},
      {:oban, "~> 2.18"}
    ]
  end
end
