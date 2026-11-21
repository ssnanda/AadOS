import SwiftUI

struct ContentView: View {
    @AppStorage("serverURL") private var serverURL = "https://os.aadnanda.com"
    @StateObject private var browser = BrowserModel()
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemGroupedBackground).ignoresSafeArea()
                if let url = validatedURL {
                    AadOSWebView(url: url, browser: browser)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    ContentUnavailableView(
                        "Server address needed",
                        systemImage: "network.slash",
                        description: Text("Open Settings and enter the HTTPS address of your AadOS server.")
                    )
                }

                if browser.isLoading {
                    ProgressView(value: browser.progress)
                        .progressViewStyle(.linear)
                        .frame(maxHeight: .infinity, alignment: .top)
                }

                if let message = browser.errorMessage {
                    VStack(spacing: 14) {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 36))
                            .foregroundStyle(.secondary)
                        Text("AadOS is unavailable").font(.headline)
                        Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("Try Again") { browser.reload() }
                            .buttonStyle(.borderedProminent)
                    }
                    .padding(24)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                    .padding()
                }
            }
            .navigationTitle("AadOS")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button { browser.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
                        .disabled(!browser.canGoBack)
                    Button { browser.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }
                        .disabled(!browser.canGoForward)
                    Spacer()
                    Button { browser.reload() } label: { Label("Reload", systemImage: "arrow.clockwise") }
                    Button { showingSettings = true } label: { Label("Settings", systemImage: "gearshape") }
                }
            }
            .sheet(isPresented: $showingSettings) {
                ServerSettingsView(serverURL: $serverURL) {
                    showingSettings = false
                    browser.load(validatedURL)
                }
            }
            .onAppear { browser.load(validatedURL) }
            .onChange(of: serverURL) { _, _ in browser.load(validatedURL) }
        }
    }

    private var validatedURL: URL? {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || (scheme == "http" && ["127.0.0.1", "localhost"].contains(url.host?.lowercased() ?? ""))
        else { return nil }
        return url
    }
}

private struct ServerSettingsView: View {
    @Binding var serverURL: String
    let done: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://os.aadnanda.com", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                } header: {
                    Text("AadOS server")
                } footer: {
                    Text("Use HTTPS except when connecting to localhost during development.")
                }
                Section("Privacy") {
                    Text("The app connects directly to your AadOS server. Your email-provider and AI credentials remain on the server.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: done) } }
        }
    }
}
