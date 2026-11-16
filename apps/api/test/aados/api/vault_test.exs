defmodule AadOS.Api.VaultTest do
  use ExUnit.Case, async: true
  alias AadOS.Api.Vault

  defp ring(version, key), do: %{current: {version, key}, ring: %{version => key}}
  @k1 :crypto.strong_rand_bytes(32)
  @k2 :crypto.strong_rand_bytes(32)

  test "round trip; ciphertext does not contain the plaintext; fresh IV each time" do
    sealed = Vault.encrypt("account:a", %{"refreshToken" => "SECRET-TOKEN"}, ring(1, @k1))
    refute sealed.ciphertext =~ "SECRET-TOKEN"
    assert {:ok, plain} = Vault.decrypt("account:a", sealed, ring(1, @k1))
    assert Jason.decode!(plain) == %{"refreshToken" => "SECRET-TOKEN"}
    other = Vault.encrypt("account:a", %{"refreshToken" => "SECRET-TOKEN"}, ring(1, @k1))
    refute other.iv == sealed.iv
  end

  test "ciphertext is bound to its scope, key and integrity" do
    sealed = Vault.encrypt("account:a", "x", ring(1, @k1))
    assert {:error, :authentication_failed} = Vault.decrypt("account:b", sealed, ring(1, @k1))
    assert {:error, :authentication_failed} = Vault.decrypt("account:a", sealed, ring(1, @k2))
    tampered = %{sealed | ciphertext: :crypto.exor(sealed.ciphertext, <<1>> <> :binary.copy(<<0>>, byte_size(sealed.ciphertext) - 1))}
    assert {:error, :authentication_failed} = Vault.decrypt("account:a", tampered, ring(1, @k1))
    assert {:error, :unknown_key_version} = Vault.decrypt("account:a", sealed, ring(2, @k2))
  end

  test "rotation: old ciphertext stays readable through the previous key" do
    old = Vault.encrypt("s", "v", ring(1, @k1))
    both = %{current: {2, @k2}, ring: %{1 => @k1, 2 => @k2}}
    assert {:ok, "v"} = Vault.decrypt("s", old, both)
    assert Vault.encrypt("s", "v", both).key_version == 2
  end

  test "keyring reads the environment and rejects bad keys" do
    on_exit(fn -> System.delete_env("AADOS_CREDENTIAL_ENCRYPTION_KEY") end)
    System.delete_env("AADOS_CREDENTIAL_ENCRYPTION_KEY")
    assert {:error, _} = Vault.keyring()
    System.put_env("AADOS_CREDENTIAL_ENCRYPTION_KEY", Base.encode64("short"))
    assert {:error, _} = Vault.keyring()
    System.put_env("AADOS_CREDENTIAL_ENCRYPTION_KEY", Base.encode64(@k1))
    assert {:ok, %{current: {1, @k1}}} = Vault.keyring()
  end
end
