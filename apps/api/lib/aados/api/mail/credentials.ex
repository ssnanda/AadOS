defmodule AadOS.Api.Mail.Credentials do
  @moduledoc "Encrypted credential rows (`mail_credentials`). Plaintext never touches the database or logs."
  alias AadOS.Api.{Repo, Vault}

  @doc "Encrypt and upsert `payload` for `scope` (`account:<id>` or `app:gmail`/`app:zoho`)."
  def put(scope, payload, keyring \\ nil) do
    keyring = keyring || fetch_keyring!()
    sealed = Vault.encrypt(scope, payload, keyring)
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.insert_all(
      "mail_credentials",
      [Map.merge(sealed, %{scope: scope, inserted_at: now, updated_at: now})],
      on_conflict: {:replace, [:key_version, :iv, :tag, :ciphertext, :updated_at]},
      conflict_target: [:scope]
    )

    :ok
  end

  @doc "Decrypt and decode the JSON payload for `scope`; `nil` when absent."
  def get(scope, keyring \\ nil) do
    keyring = keyring || fetch_keyring!()

    case Repo.query!("SELECT key_version, iv, tag, ciphertext FROM mail_credentials WHERE scope = $1", [scope]).rows do
      [[version, iv, tag, ciphertext]] ->
        with {:ok, plain} <- Vault.decrypt(scope, %{key_version: version, iv: iv, tag: tag, ciphertext: ciphertext}, keyring) do
          {:ok, Jason.decode!(plain)}
        end

      [] ->
        nil
    end
  end

  @doc "Re-encrypt every row not yet on the current key version. Returns the number of rows rotated."
  def rotate(keyring \\ nil) do
    %{current: {current, _}} = keyring = keyring || fetch_keyring!()

    Repo.transaction(fn ->
      rows = Repo.query!("SELECT scope FROM mail_credentials WHERE key_version <> $1 FOR UPDATE", [current]).rows

      Enum.each(rows, fn [scope] ->
        {:ok, payload} = get(scope, keyring)
        :ok = put(scope, payload, keyring)
      end)

      length(rows)
    end)
  end

  defp fetch_keyring! do
    case Vault.keyring() do
      {:ok, keyring} -> keyring
      {:error, reason} -> raise ArgumentError, reason
    end
  end
end
