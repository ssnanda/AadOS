defmodule AadOS.Api.Repo.Migrations.CreateCredentialsAndTasks do
  use Ecto.Migration

  # Additive. Provider tokens are stored only as AES-256-GCM ciphertext (see AadOS.Api.Vault); `scope` is bound as AAD.
  def change do
    create table(:mail_credentials, primary_key: false) do
      add :scope, :string, primary_key: true
      add :key_version, :integer, null: false
      add :iv, :binary, null: false
      add :tag, :binary, null: false
      add :ciphertext, :binary, null: false
      timestamps(type: :utc_datetime)
    end

    create table(:mail_tasks, primary_key: false) do
      add :id, :string, primary_key: true
      add :title, :text, null: false
      add :due, :date
      add :priority, :string, null: false, default: "normal"
      add :done, :boolean, null: false, default: false
      add :completed_at, :utc_datetime
      add :email_key, :string
      timestamps(type: :utc_datetime)
    end

    create constraint(:mail_tasks, :priority_known, check: "priority in ('high','normal','low')")
    create index(:mail_tasks, [:done, :due])
  end
end
