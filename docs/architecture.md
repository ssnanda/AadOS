# AadOS architecture (implementation baseline)

AadOS is **not** Family OS, AJMCP, or AJ Core. The source of truth is `ssnanda/AadOS` on `main`.

| Layer | Agreed direction | Bootstrap status |
| --- | --- | --- |
| Web | SvelteKit 2, Svelte 5, TypeScript, Tailwind 4 | App scaffold, API-backed empty inbox |
| API | Elixir/Phoenix, JSON REST | Health, email overview and read-only stub APIs |
| Jobs/data | Ecto, PostgreSQL/CloudNativePG, Oban; future RLS/pgvector | Dependencies and opt-in Repo/Oban startup; no mail schema yet |
| iOS | SwiftUI, SwiftData, Keychain | Signing-safe build script; application later |
| Identity | Password gate now; WebAuthn, RBAC/ReBAC, encrypted tokens later | Single owner login with resettable scrypt hash |
| AI | LiteLLM/Ollama/llama.cpp; LangGraph | Later; human approval for all state-changing actions |
| Files | RustFS; later documents | Later |
| Operations | OpenShift oc ImageStreams/BuildConfigs, GitHub Actions; later Argo CD | Binary builds, HTTPS Ingress and CI (Helm chart retained as reference) |
| Observability | OpenTelemetry/Grafana LGTM | Later |

The initial email experience is provider-agnostic and read-only. Each connector will preserve the source mailbox and enforce account-specific access; token grants will be per-account and stored encrypted at rest. Provider sync and AI classification will run asynchronously once a secure database schema and identity foundation exist.

**Current trust model**: the public web workspace has a single-owner password gate; resetting the stored hash invalidates signed sessions. There is no OAuth, MFA or per-account authorization yet. The API returns only empty, static connection state. Live connectors and AI handling of personal email remain blocked until those security gates land.
