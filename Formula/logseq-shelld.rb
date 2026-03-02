class LogseqShelld < Formula
  desc "Local PTY daemon for Logseq Shell"
  homepage "https://github.com/rankun203/logseq-shell"
  head "https://github.com/rankun203/logseq-shell.git", branch: "master"

  depends_on "rust" => :build

  def install
    system "cargo", "install", *std_cargo_args(path: "crates/logseq-shelld")
  end

  service do
    run [opt_bin/"logseq-shelld", "--host", "127.0.0.1", "--port", "34981"]
    keep_alive true
    run_type :immediate
    log_path var/"log/logseq-shelld.log"
    error_log_path var/"log/logseq-shelld.error.log"
  end

  test do
    assert_match "logseq-shelld", shell_output("#{bin}/logseq-shelld --help")
  end
end
