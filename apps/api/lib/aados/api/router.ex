defmodule AadOS.Api.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :service_auth do
    plug AadOS.Api.Plugs.ServiceAuth
  end

  # Service-to-service (web app -> API). Bearer token required; no user-facing access.
  scope "/internal/v1", AadOS.Api.Controllers do
    pipe_through [:api, :service_auth]

    post "/mirror/refresh", InternalController, :refresh_mirror
    get "/summary", InternalController, :summary
    get "/accounts", InternalController, :accounts
    get "/messages", InternalController, :messages
  end

  scope "/api", AadOS.Api.Controllers do
    pipe_through :api

    get "/health", HealthController, :index
    get "/v1/email/overview", EmailController, :overview
    get "/v1/email/accounts", EmailController, :accounts
    get "/v1/email/messages", EmailController, :messages
  end
end
