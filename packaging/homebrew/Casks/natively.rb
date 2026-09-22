cask "natively" do
  arch arm: "-arm64"

  version "2.8.8"
  sha256 arm:   "db6d48883b9c8d4c527e25fce5c8703b99eed57f4be1ae00d286223071fffe06",
         intel: "921ba19639fff4dbaaefb15c55fdfcc3f4d16eb621929da830e4a98cb7c84a8d"

  url "https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/download/V#{version}/Natively-#{version}#{arch}.dmg",
      verified: "github.com/Natively-AI-assistant/natively-cluely-ai-assistant/"
  name "Natively"
  desc "AI meeting assistant, interview copilot, and note taker"
  homepage "https://natively.software/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :monterey

  app "Natively.app"

  # Paths are derived from package.json "name" (natively), NOT the "Natively"
  # product name, because that is what Electron's app.getName() returns and
  # therefore what app.getPath('userData'|'logs'|'cache') resolves to. The
  # preference domain uses build.appId instead. Verified against a real install.
  zap trash: [
    "~/Library/Application Support/natively",
    "~/Library/Caches/natively",
    "~/Library/Caches/natively-updater",
    "~/Library/Logs/natively",
    "~/Library/Preferences/com.electron.meeting-notes.plist",
    "~/Library/Saved Application State/com.electron.meeting-notes.savedState",
  ]
end
