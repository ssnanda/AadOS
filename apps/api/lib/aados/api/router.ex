defmodule AadOS.Api.Router do
  use Phoenix.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", AadOS.Api.Controllers do
    pipe_through :api

    get "/health", HealthController, :index
    get "/v1/email/overview", EmailController, :overview
    get "/v1/email/accounts", EmailController, :accounts
    get "/v1/email/messages", EmailController, :messages
  end
end
