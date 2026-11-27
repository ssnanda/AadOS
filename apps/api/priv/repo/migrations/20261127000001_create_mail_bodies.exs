defmodule AadOS.Api.Repo.Migrations.CreateMailBodies do
  use Ecto.Migration

  # Additive only. Full-text search over email bodies, filled in the background by the web app
  # (apps/web/src/lib/server/body-index.ts). Kept separate from mail_messages because that table is
  # a mirror rebuilt from app state; this one survives rebuilds. Rows for emails removed from AadOS
  # are pruned by the indexer. Mailboxes are never changed by it.
  def change do
    create table(:mail_bodies, primary_key: false) do
      add :account_id, :string, primary_key: true
      add :provider_message_id, :string, primary_key: true
      # Subject + sender + recipients + plain body text (HTML stripped, capped by the indexer).
      add :text, :text, null: false, default: ""
      add :indexed_at, :utc_datetime, null: false, default: fragment("now()")
    end

    execute(
      """
      ALTER TABLE mail_bodies ADD COLUMN search tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', left(coalesce(text,''), 200000))) STORED
      """,
      "ALTER TABLE mail_bodies DROP COLUMN search"
    )

    execute("CREATE INDEX mail_bodies_search_idx ON mail_bodies USING GIN (search)", "DROP INDEX mail_bodies_search_idx")
  end
end
