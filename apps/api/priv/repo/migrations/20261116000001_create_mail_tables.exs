defmodule AadOS.Api.Repo.Migrations.CreateMailTables do
  use Ecto.Migration

  # Additive only: new tables, nothing dropped. OAuth tokens are intentionally NOT stored here yet;
  # they stay in the encrypted state file until a keyed credential vault is implemented.
  def change do
    create table(:mail_accounts, primary_key: false) do
      add :id, :string, primary_key: true
      add :provider, :string, null: false
      add :email, :string, null: false, default: ""
      add :remote_id, :string, null: false, default: ""
      add :paused, :boolean, null: false, default: false
      add :last_sync_at, :utc_datetime
      add :last_error, :text
      timestamps(type: :utc_datetime)
    end

    create constraint(:mail_accounts, :provider_known, check: "provider in ('gmail','zoho')")

    create table(:mail_messages) do
      add :account_id, references(:mail_accounts, type: :string, on_delete: :restrict), null: false
      add :provider_message_id, :string, null: false
      add :thread_id, :string
      add :subject, :text, null: false, default: ""
      add :sender, :text, null: false, default: ""
      add :summary, :text, null: false, default: ""
      add :received_at, :utc_datetime
      add :unread, :boolean, null: false, default: true
      add :kind, :string, null: false, default: "other"
      add :facts, :map, null: false, default: %{}
      add :categories, {:array, :string}, null: false, default: []
      add :importance, :string
      add :action_state, :string
      add :follow_up_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    # One source message = one row per account, however many views/labels it appears in.
    create unique_index(:mail_messages, [:account_id, :provider_message_id])
    create index(:mail_messages, [:received_at])
    create index(:mail_messages, [:account_id, :thread_id])

    execute(
      """
      ALTER TABLE mail_messages ADD COLUMN search tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(sender,'') || ' ' || coalesce(summary,''))) STORED
      """,
      "ALTER TABLE mail_messages DROP COLUMN search"
    )

    execute("CREATE INDEX mail_messages_search_idx ON mail_messages USING GIN (search)", "DROP INDEX mail_messages_search_idx")

    create table(:mail_message_views) do
      add :message_id, references(:mail_messages, on_delete: :delete_all), null: false
      add :view_id, :string, null: false
    end

    create unique_index(:mail_message_views, [:message_id, :view_id])

    create table(:mail_sync_checkpoints) do
      add :account_id, references(:mail_accounts, type: :string, on_delete: :delete_all), null: false
      add :folder_id, :string, null: false
      add :cursor, :string
      add :history_id, :string
      add :last_sync_at, :utc_datetime
      add :last_error, :text
      timestamps(type: :utc_datetime)
    end

    create unique_index(:mail_sync_checkpoints, [:account_id, :folder_id])
  end
end
