defmodule AadOS.Api.Repo.Migrations.CreateAppState do
  use Ecto.Migration

  # Primary application state when AADOS_STORAGE=postgres (written by the web app). One row, replaced transactionally
  # (SELECT ... FOR UPDATE). Provider tokens and OAuth app secrets are NOT in `data`; they live encrypted in mail_credentials.
  def change do
    create table(:app_state, primary_key: false) do
      add :id, :integer, primary_key: true
      add :data, :map, null: false
      add :version, :bigint, null: false, default: 0
      add :migrated_from, :string
      add :migrated_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create constraint(:app_state, :single_row, check: "id = 1")
  end
end
