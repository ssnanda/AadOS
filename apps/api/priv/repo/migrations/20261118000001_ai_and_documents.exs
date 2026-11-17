defmodule AadOS.Api.Repo.Migrations.AiAndDocuments do
  use Ecto.Migration

  # Additive and reversible. Written by the web app (AI assistant, email insights, drafts, briefings, documents).
  # Documents: metadata + extracted text here; file content lives in the owner's RustFS bucket.
  def change do
    create table(:ai_conversations, primary_key: false) do
      add :id, :string, primary_key: true
      add :title, :string, null: false
      timestamps(type: :utc_datetime)
    end

    create index(:ai_conversations, [:updated_at])

    create table(:ai_messages) do
      add :conversation_id, references(:ai_conversations, type: :string, on_delete: :delete_all), null: false
      add :role, :string, null: false
      add :content, :text, null: false
      add :sources, :map, null: false, default: fragment("'[]'::jsonb")
      add :provider, :string
      add :model, :string
      add :usage, :map
      add :latency_ms, :integer
      add :error, :text
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create constraint(:ai_messages, :role_known, check: "role in ('user','assistant')")
    create index(:ai_messages, [:conversation_id, :inserted_at])

    create table(:ai_insights, primary_key: false) do
      add :message_key, :string, primary_key: true
      add :fingerprint, :string, null: false
      add :status, :string, null: false
      add :insight, :map
      add :error, :text
      add :attempts, :integer, null: false, default: 0
      add :provider, :string
      add :model, :string
      add :reviewed_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create constraint(:ai_insights, :status_known, check: "status in ('done','failed')")

    create table(:ai_drafts) do
      add :message_key, :string, null: false
      add :content, :text, null: false
      add :tone, :string
      add :ai_generated, :boolean, null: false, default: true
      add :edited, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create index(:ai_drafts, [:message_key])

    create table(:ai_briefings) do
      add :content, :map, null: false
      add :provider, :string
      add :model, :string
      add :generated_at, :utc_datetime, null: false
    end

    create table(:documents, primary_key: false) do
      add :id, :string, primary_key: true
      add :filename, :text, null: false
      add :object_key, :string, null: false
      add :mime, :string, null: false
      add :size, :bigint, null: false
      add :checksum, :string, null: false
      add :folder, :string, null: false, default: ""
      add :category, :string, null: false, default: ""
      add :source_type, :string, null: false, default: "upload"
      add :source_ref, :string
      add :extraction_status, :string, null: false, default: "pending"
      add :extraction_error, :text
      add :text, :text
      timestamps(type: :utc_datetime)
    end

    create unique_index(:documents, [:object_key])
    create unique_index(:documents, [:source_type, :source_ref], where: "source_ref IS NOT NULL", name: :documents_source_unique)
    create index(:documents, [:checksum])
    create constraint(:documents, :extraction_known, check: "extraction_status in ('pending','done','failed','unsupported')")

    execute(
      """
      ALTER TABLE documents ADD COLUMN search tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(filename,'') || ' ' || coalesce(folder,'') || ' ' || coalesce(category,'') || ' ' || left(coalesce(text,''), 1000000))
      ) STORED
      """,
      "ALTER TABLE documents DROP COLUMN search"
    )

    execute("CREATE INDEX documents_search_idx ON documents USING GIN (search)", "DROP INDEX documents_search_idx")
  end
end
