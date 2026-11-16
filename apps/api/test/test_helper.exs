# Database tests (tag :db) run only when AADOS_TEST_DATABASE_URL points at a database whose name ends in `_test`
# (CI provides a PostgreSQL service). Otherwise they are excluded, so `mix test` works with no database.
db_url = System.get_env("AADOS_TEST_DATABASE_URL")

if db_url do
  path = URI.parse(db_url).path || ""
  unless String.ends_with?(path, "_test"), do: raise("AADOS_TEST_DATABASE_URL must name a *_test database")
  Application.put_env(:aados_api, AadOS.Api.Repo, url: db_url, pool_size: 10)
  {:ok, _} = AadOS.Api.Repo.start_link()
  Ecto.Migrator.run(AadOS.Api.Repo, :up, all: true, log: false)
end

ExUnit.start(exclude: if(db_url, do: [], else: [:db]))
