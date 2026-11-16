defmodule AadOS.Api.Vault do
  @moduledoc """
  Authenticated encryption (AES-256-GCM) for provider credentials stored in PostgreSQL.

  * The key comes from `AADOS_CREDENTIAL_ENCRYPTION_KEY` (base64 of 32 random bytes), never from the session secret.
  * `AADOS_CREDENTIAL_KEY_VERSION` (default 1) labels the current key; an optional previous key
    (`AADOS_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` + `AADOS_CREDENTIAL_KEY_VERSION_PREVIOUS`) stays readable during rotation.
  * Each value uses a fresh 96-bit IV and is bound to its `scope` (e.g. `account:gmail-foo`) as AAD, so a ciphertext
    copied to another row fails authentication.

  Generate a key with: `openssl rand -base64 32`.
  """

  @iv_bytes 12
  @tag_bytes 16
  @aad "aados:cred:v1:"

  @type keyring :: %{current: {pos_integer(), binary()}, ring: %{pos_integer() => binary()}}
  @type sealed :: %{key_version: pos_integer(), iv: binary(), tag: binary(), ciphertext: binary()}

  @doc "Key ring from the environment, or `{:error, reason}`."
  @spec keyring() :: {:ok, keyring()} | {:error, String.t()}
  def keyring do
    with {:ok, key} <- decode_key(System.get_env("AADOS_CREDENTIAL_ENCRYPTION_KEY")) do
      version = parse_version(System.get_env("AADOS_CREDENTIAL_KEY_VERSION"), 1)
      ring = %{version => key}

      ring =
        case decode_key(System.get_env("AADOS_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS")) do
          {:ok, previous} -> Map.put_new(ring, parse_version(System.get_env("AADOS_CREDENTIAL_KEY_VERSION_PREVIOUS"), 0), previous)
          _ -> ring
        end

      {:ok, %{current: {version, key}, ring: ring}}
    end
  end

  @spec encrypt(String.t(), map() | binary(), keyring()) :: sealed()
  def encrypt(scope, payload, %{current: {version, key}}) do
    plaintext = if is_binary(payload), do: payload, else: Jason.encode!(payload)
    iv = :crypto.strong_rand_bytes(@iv_bytes)
    {ciphertext, tag} = :crypto.crypto_one_time_aead(:aes_256_gcm, key, iv, plaintext, @aad <> scope, @tag_bytes, true)
    %{key_version: version, iv: iv, tag: tag, ciphertext: ciphertext}
  end

  @spec decrypt(String.t(), sealed(), keyring()) :: {:ok, binary()} | {:error, :unknown_key_version | :authentication_failed}
  def decrypt(scope, %{key_version: version, iv: iv, tag: tag, ciphertext: ciphertext}, %{ring: ring}) do
    case Map.fetch(ring, version) do
      :error ->
        {:error, :unknown_key_version}

      {:ok, key} ->
        case :crypto.crypto_one_time_aead(:aes_256_gcm, key, iv, ciphertext, @aad <> scope, tag, false) do
          :error -> {:error, :authentication_failed}
          plaintext when is_binary(plaintext) -> {:ok, plaintext}
        end
    end
  end

  defp decode_key(nil), do: {:error, "AADOS_CREDENTIAL_ENCRYPTION_KEY is not set"}

  defp decode_key(value) do
    case Base.decode64(String.trim(value)) do
      {:ok, key} when byte_size(key) == 32 -> {:ok, key}
      _ -> {:error, "credential encryption key must be base64 of exactly 32 bytes"}
    end
  end

  defp parse_version(nil, default), do: default

  defp parse_version(value, default) do
    case Integer.parse(value) do
      {n, ""} when n >= 0 -> n
      _ -> default
    end
  end
end
