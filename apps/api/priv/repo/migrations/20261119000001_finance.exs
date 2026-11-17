defmodule AadOS.Api.Repo.Migrations.Finance do
  use Ecto.Migration

  # Phase 5 — Finance & Investments (ported from AJAdvisor). Additive and reversible; written by the web app.
  # Money, prices and quantities are NUMERIC (exact decimal). Ids are strings so AJAdvisor's cuids are kept on
  # migration (relationships survive; re-running the import never duplicates). `source` separates manual records
  # from provider-synced ones ('manual' | 'etrade' | 'plaid' | 'ajadvisor'). Provider secrets are NOT stored here —
  # they live in the encrypted credential vault with the other integration secrets.
  def change do
    for name <- [:fin_account_types, :fin_owners, :fin_brokerages, :fin_categories] do
      create table(name, primary_key: false) do
        add :id, :string, primary_key: true
        add :name, :string, null: false
        timestamps(type: :utc_datetime)
      end

      create unique_index(name, [:name])
    end

    create table(:fin_accounts, primary_key: false) do
      add :id, :string, primary_key: true
      add :name, :string, null: false
      add :type, :string, null: false, default: "Regular Brokerage"
      add :owner, :string
      add :brokerage, :string
      add :source, :string, null: false, default: "manual"
      add :etrade_account_id_key, :string
      add :plaid_account_id, :string
      add :plaid_item_id, :string
      add :notes, :text
      add :last_synced_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create unique_index(:fin_accounts, [:etrade_account_id_key])
    create unique_index(:fin_accounts, [:plaid_account_id])

    create table(:fin_holdings, primary_key: false) do
      add :id, :string, primary_key: true
      add :account_id, references(:fin_accounts, type: :string, on_delete: :delete_all), null: false
      add :ticker, :string, null: false
      add :name, :string, null: false
      add :quantity, :decimal, null: false
      add :cost_basis, :decimal, null: false, default: 0
      add :current_price, :decimal
      add :previous_close, :decimal
      add :price_source, :string
      add :price_at, :utc_datetime
      add :source, :string, null: false, default: "manual"
      add :notes, :text
      timestamps(type: :utc_datetime)
    end

    create index(:fin_holdings, [:account_id])
    create index(:fin_holdings, [:ticker])

    create table(:fin_holding_categories, primary_key: false) do
      add :holding_id, references(:fin_holdings, type: :string, on_delete: :delete_all), primary_key: true
      add :category_id, references(:fin_categories, type: :string, on_delete: :delete_all), primary_key: true
    end

    create table(:fin_holding_snapshots, primary_key: false) do
      add :id, :string, primary_key: true
      add :date, :date, null: false
      add :holding_id, :string, null: false
      add :account_id, :string, null: false
      add :ticker, :string, null: false
      add :name, :string, null: false
      add :quantity, :decimal, null: false
      add :price, :decimal
      add :market_value, :decimal
      add :cost_basis, :decimal, null: false
      add :day_change, :decimal
      timestamps(type: :utc_datetime)
    end

    create unique_index(:fin_holding_snapshots, [:date, :holding_id])
    create index(:fin_holding_snapshots, [:holding_id])

    create table(:fin_account_snapshots, primary_key: false) do
      add :id, :string, primary_key: true
      add :date, :date, null: false
      add :account_id, :string, null: false
      add :name, :string, null: false
      add :type, :string, null: false
      add :market_value, :decimal, null: false
      add :cost_basis, :decimal, null: false
      add :cash, :decimal, null: false
      add :day_change, :decimal, null: false
      timestamps(type: :utc_datetime)
    end

    create unique_index(:fin_account_snapshots, [:date, :account_id])

    create table(:fin_portfolio_snapshots, primary_key: false) do
      add :id, :string, primary_key: true
      add :date, :date, null: false
      add :total_market_value, :decimal, null: false
      add :total_cost_basis, :decimal, null: false
      add :total_cash, :decimal, null: false
      add :day_change, :decimal, null: false
      add :stocks_value, :decimal, null: false
      add :funds_value, :decimal, null: false
      add :cash_value, :decimal, null: false
      add :real_estate_value, :decimal, null: false
      add :real_estate_equity, :decimal
      add :benchmarks, :map, null: false, default: fragment("'{}'::jsonb")
      timestamps(type: :utc_datetime)
    end

    create unique_index(:fin_portfolio_snapshots, [:date])

    create table(:fin_plans, primary_key: false) do
      add :id, :string, primary_key: true
      add :ticker, :string, null: false
      add :name, :string
      add :purpose, :text
      add :strategy, :text
      add :target_allocation_percent, :decimal
      add :max_allocation_percent, :decimal
      add :buy_range_low, :decimal
      add :buy_range_high, :decimal
      add :trim_range_low, :decimal
      add :trim_range_high, :decimal
      add :thesis, :text
      add :exit_conditions, :text
      add :notes, :text
      add :next_review_date, :date
      timestamps(type: :utc_datetime)
    end

    create unique_index(:fin_plans, [:ticker])

    create table(:fin_decisions, primary_key: false) do
      add :id, :string, primary_key: true
      add :ticker, :string, null: false
      add :name, :string
      add :type, :string, null: false
      add :notes, :text
      add :status, :string, null: false, default: "open"
      add :scheduled_for, :utc_datetime
      add :decided_at, :utc_datetime, null: false
      add :resolved_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create constraint(:fin_decisions, :decision_type_known, check: "type in ('buy','add','hold','trim','sell','avoid','research')")
    create constraint(:fin_decisions, :decision_status_known, check: "status in ('open','completed','dismissed','scheduled')")
    create index(:fin_decisions, [:status])
    create index(:fin_decisions, [:ticker])

    create table(:fin_muted_signals, primary_key: false) do
      add :id, :string, primary_key: true
      add :signal_id, :string, null: false
      add :signal_title, :string, null: false
      add :signal_kind, :string, null: false
      add :ticker, :string
      add :muted_at, :utc_datetime, null: false
      add :muted_until, :utc_datetime
      add :unmuted_at, :utc_datetime
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:fin_muted_signals, [:signal_id])

    create table(:fin_watchlist, primary_key: false) do
      add :id, :string, primary_key: true
      add :ticker, :string, null: false
      add :name, :string, null: false, default: ""
      add :target_price, :decimal
      add :dip_percent, :decimal, null: false, default: 5
      add :thesis, :text, null: false, default: ""
      add :current_price, :decimal
      add :previous_close, :decimal
      add :price_at, :utc_datetime
      timestamps(type: :utc_datetime)
    end

    create unique_index(:fin_watchlist, [:ticker])

    create table(:fin_properties, primary_key: false) do
      add :id, :string, primary_key: true
      add :location, :string, null: false
      add :name, :string
      add :units, :integer, null: false, default: 1
      add :cost, :decimal
      add :owner, :string
      add :year_acquired, :integer
      add :market_value, :decimal
      add :mortgage_balance, :decimal
      add :mortgage, :string
      add :mortgage_payment, :decimal
      add :current_rent, :decimal
      add :normalized_rent, :decimal
      add :interest_overall, :decimal
      add :interest_property, :decimal
      add :insurance, :decimal
      add :hoa, :decimal
      add :real_estate_tax, :decimal
      add :other_expenses, :decimal
      add :income, :decimal
      add :zestimate, :decimal
      add :zestimate_updated_at, :utc_datetime
      add :notes, :text
      add :source, :string, null: false, default: "manual"
      timestamps(type: :utc_datetime)
    end

    create unique_index(:fin_properties, [:location])

    create table(:fin_property_valuations) do
      add :property_id, references(:fin_properties, type: :string, on_delete: :delete_all), null: false
      add :date, :date, null: false
      add :market_value, :decimal
      add :mortgage_balance, :decimal
      add :source, :string, null: false, default: "manual"
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:fin_property_valuations, [:property_id, :date])

    # Key/value settings (thresholds, earnings cache, last refresh, alert preferences).
    create table(:fin_settings, primary_key: false) do
      add :key, :string, primary_key: true
      add :value, :map, null: false
      timestamps(type: :utc_datetime, inserted_at: false)
    end

    # One row per alert actually raised (dedupe key per day), so a condition notifies once.
    create table(:fin_alerts) do
      add :key, :string, null: false
      add :kind, :string, null: false
      add :ticker, :string
      add :title, :text, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:fin_alerts, [:key])

    # Each AJAdvisor import run (dry-run or apply) with its counts and reconciliation report.
    create table(:fin_import_runs) do
      add :source, :string, null: false
      add :mode, :string, null: false
      add :summary, :map, null: false
      timestamps(type: :utc_datetime, updated_at: false)
    end
  end
end
