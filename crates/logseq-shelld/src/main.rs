use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::SocketAddr,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};

use anyhow::{bail, Context};
use axum::{
    extract::{ws::Message, Query, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use clap::Parser;
use futures::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;
use tracing::{info, warn};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Parser, Debug, Clone)]
#[command(name = "logseq-shelld")]
#[command(about = "Local PTY daemon for logseq-shell")]
struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    #[arg(long, default_value_t = 34981)]
    port: u16,

    #[arg(long)]
    token: Option<String>,

    #[arg(long)]
    shell: Option<String>,

    #[arg(long, default_value = "logseq-shelld")]
    service_name: String,

    #[arg(long, help = "Install and start as a background service, then exit")]
    install_service: bool,

    #[arg(long, help = "Stop and remove background service, then exit")]
    uninstall_service: bool,

    #[arg(long, help = "Print background service status, then exit")]
    service_status: bool,
}

#[derive(Clone)]
struct AppState {
    args: Args,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMsg {
    Hello {
        client: Option<String>,
    },
    Spawn {
        cwd: Option<String>,
        command: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
    },
    Input {
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        data: String,
    },
    Resize {
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        cols: u16,
        rows: u16,
    },
    Close {
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    Ping,
}

#[derive(Debug)]
enum InternalEvent {
    Output {
        session_id: String,
        chunk: Vec<u8>,
    },
    Exit {
        session_id: String,
        code: i32,
        signal: Option<String>,
    },
}

struct ActiveSession {
    id: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
}

impl ActiveSession {
    fn close(&mut self) {
        if let Err(e) = self.killer.kill() {
            warn!("failed to kill session {}: {e}", self.id);
        }
    }
}

fn next_session_id() -> String {
    format!("s{}", SESSION_COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn pick_shell(args: &Args) -> String {
    args.shell
        .clone()
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/bash".to_string())
}

fn normalize_cwd(cwd: &str) -> Option<PathBuf> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return None;
    }

    let expanded = if trimmed == "~" {
        std::env::var("HOME").ok()?
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        let home = std::env::var("HOME").ok()?;
        format!("{home}/{rest}")
    } else {
        trimmed.to_string()
    };

    let p = PathBuf::from(expanded);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

fn service_runtime_args(args: &Args) -> Vec<String> {
    let mut cmd = vec![
        "--host".to_string(),
        args.host.clone(),
        "--port".to_string(),
        args.port.to_string(),
    ];

    if let Some(token) = &args.token {
        cmd.push("--token".to_string());
        cmd.push(token.clone());
    }

    if let Some(shell) = &args.shell {
        cmd.push("--shell".to_string());
        cmd.push(shell.clone());
    }

    cmd
}

fn home_dir() -> anyhow::Result<PathBuf> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .context("HOME env var is not set")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn shell_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn launchd_label(args: &Args) -> String {
    format!("ai.logseq.{}", args.service_name.replace('_', "-"))
}

fn launchd_plist_path(args: &Args) -> anyhow::Result<PathBuf> {
    Ok(home_dir()?
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", launchd_label(args))))
}

fn systemd_unit_name(args: &Args) -> String {
    format!("{}.service", args.service_name)
}

fn systemd_unit_path(args: &Args) -> anyhow::Result<PathBuf> {
    Ok(home_dir()?
        .join(".config/systemd/user")
        .join(systemd_unit_name(args)))
}

fn install_service(args: &Args) -> anyhow::Result<()> {
    match std::env::consts::OS {
        "macos" => install_launchd_service(args),
        "linux" => install_systemd_user_service(args),
        other => bail!("service install is not supported on this OS: {other}"),
    }
}

fn uninstall_service(args: &Args) -> anyhow::Result<()> {
    match std::env::consts::OS {
        "macos" => uninstall_launchd_service(args),
        "linux" => uninstall_systemd_user_service(args),
        other => bail!("service uninstall is not supported on this OS: {other}"),
    }
}

fn service_status(args: &Args) -> anyhow::Result<()> {
    match std::env::consts::OS {
        "macos" => service_status_launchd(args),
        "linux" => service_status_systemd_user(args),
        other => bail!("service status is not supported on this OS: {other}"),
    }
}

fn install_launchd_service(args: &Args) -> anyhow::Result<()> {
    let home = home_dir()?;
    let launch_agents_dir = home.join("Library/LaunchAgents");
    fs::create_dir_all(&launch_agents_dir)
        .with_context(|| format!("create {}", launch_agents_dir.display()))?;

    let logs_dir = home.join("Library/Logs");
    fs::create_dir_all(&logs_dir).with_context(|| format!("create {}", logs_dir.display()))?;

    let label = format!("ai.logseq.{}", args.service_name.replace('_', "-"));
    let plist_path = launch_agents_dir.join(format!("{label}.plist"));

    let exe = std::env::current_exe().context("resolve current executable path")?;
    let mut program_args = vec![exe.to_string_lossy().to_string()];
    program_args.extend(service_runtime_args(args));

    let program_args_xml = program_args
        .iter()
        .map(|a| format!("    <string>{}</string>", xml_escape(a)))
        .collect::<Vec<_>>()
        .join(
            "
",
        );

    let stdout_log = logs_dir.join(format!("{}.log", args.service_name));
    let stderr_log = logs_dir.join(format!("{}.error.log", args.service_name));

    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
{program_args_xml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{stdout_log}</string>
  <key>StandardErrorPath</key>
  <string>{stderr_log}</string>
</dict>
</plist>
"#,
        label = xml_escape(&label),
        program_args_xml = program_args_xml,
        stdout_log = xml_escape(&stdout_log.to_string_lossy()),
        stderr_log = xml_escape(&stderr_log.to_string_lossy()),
    );

    fs::write(&plist_path, plist).with_context(|| format!("write {}", plist_path.display()))?;

    let plist = plist_path.to_string_lossy().to_string();
    let _ = Command::new("launchctl").args(["unload", &plist]).status();

    let status = Command::new("launchctl")
        .args(["load", "-w", &plist])
        .status()
        .context("run launchctl load")?;

    if !status.success() {
        bail!("launchctl load failed with status {status}");
    }

    info!(
        "installed launchd service '{}' and started it (plist: {})",
        label,
        plist_path.display()
    );

    Ok(())
}

fn install_systemd_user_service(args: &Args) -> anyhow::Result<()> {
    let home = home_dir()?;
    let systemd_user_dir = home.join(".config/systemd/user");
    fs::create_dir_all(&systemd_user_dir)
        .with_context(|| format!("create {}", systemd_user_dir.display()))?;

    let unit_name = format!("{}.service", args.service_name);
    let unit_path = systemd_user_dir.join(&unit_name);

    let exe = std::env::current_exe().context("resolve current executable path")?;
    let mut cmdline = vec![exe.to_string_lossy().to_string()];
    cmdline.extend(service_runtime_args(args));

    let exec_start = cmdline
        .iter()
        .map(|a| format!("\"{}\"", shell_escape(a)))
        .collect::<Vec<_>>()
        .join(" ");

    let unit = format!(
        "[Unit]
Description=logseq-shelld local PTY daemon
After=default.target

[Service]
Type=simple
ExecStart={}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
",
        exec_start
    );

    fs::write(&unit_path, unit).with_context(|| format!("write {}", unit_path.display()))?;

    let status = Command::new("systemctl")
        .args(["--user", "daemon-reload"])
        .status()
        .context("run systemctl --user daemon-reload")?;

    if !status.success() {
        bail!("systemctl --user daemon-reload failed with status {status}");
    }

    let status = Command::new("systemctl")
        .args(["--user", "enable", "--now", &unit_name])
        .status()
        .context("run systemctl --user enable --now")?;

    if !status.success() {
        bail!("systemctl --user enable --now failed with status {status}");
    }

    info!(
        "installed systemd user service '{}' and started it (unit: {})",
        unit_name,
        unit_path.display()
    );
    info!(
        "tip: if you need auto-start without login, run once with sudo: loginctl enable-linger $USER"
    );

    Ok(())
}

fn uninstall_launchd_service(args: &Args) -> anyhow::Result<()> {
    let label = launchd_label(args);
    let plist_path = launchd_plist_path(args)?;
    let plist = plist_path.to_string_lossy().to_string();

    match Command::new("launchctl")
        .args(["unload", "-w", &plist])
        .status()
    {
        Ok(status) if status.success() => {}
        Ok(status) => warn!("launchctl unload returned status {status} (continuing)"),
        Err(e) => warn!("launchctl unload failed: {e} (continuing)"),
    }

    let _ = Command::new("launchctl").args(["remove", &label]).status();

    if plist_path.exists() {
        fs::remove_file(&plist_path).with_context(|| format!("remove {}", plist_path.display()))?;
    }

    info!(
        "uninstalled launchd service '{}' (plist: {})",
        label,
        plist_path.display()
    );
    Ok(())
}

fn uninstall_systemd_user_service(args: &Args) -> anyhow::Result<()> {
    let unit_name = systemd_unit_name(args);
    let unit_path = systemd_unit_path(args)?;

    match Command::new("systemctl")
        .args(["--user", "disable", "--now", &unit_name])
        .status()
    {
        Ok(status) if status.success() => {}
        Ok(status) => warn!("systemctl --user disable --now returned status {status} (continuing)"),
        Err(e) => warn!("systemctl --user disable --now failed: {e} (continuing)"),
    }

    if unit_path.exists() {
        fs::remove_file(&unit_path).with_context(|| format!("remove {}", unit_path.display()))?;
    }

    let status = Command::new("systemctl")
        .args(["--user", "daemon-reload"])
        .status()
        .context("run systemctl --user daemon-reload")?;

    if !status.success() {
        bail!("systemctl --user daemon-reload failed with status {status}");
    }

    info!(
        "uninstalled systemd user service '{}' (unit: {})",
        unit_name,
        unit_path.display()
    );
    Ok(())
}

fn service_status_launchd(args: &Args) -> anyhow::Result<()> {
    let label = launchd_label(args);
    let plist_path = launchd_plist_path(args)?;

    let loaded = Command::new("launchctl")
        .args(["list", &label])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    println!("platform: macos");
    println!("service_name: {}", args.service_name);
    println!("label: {}", label);
    println!("plist_path: {}", plist_path.display());
    println!("plist_exists: {}", plist_path.exists());
    println!("loaded: {}", loaded);

    Ok(())
}

fn service_status_systemd_user(args: &Args) -> anyhow::Result<()> {
    let unit_name = systemd_unit_name(args);
    let unit_path = systemd_unit_path(args)?;

    let enabled_out = Command::new("systemctl")
        .args(["--user", "is-enabled", &unit_name])
        .output()
        .context("run systemctl --user is-enabled")?;

    let active_out = Command::new("systemctl")
        .args(["--user", "is-active", &unit_name])
        .output()
        .context("run systemctl --user is-active")?;

    let enabled = {
        let stdout = String::from_utf8_lossy(&enabled_out.stdout)
            .trim()
            .to_string();
        if stdout.is_empty() {
            String::from_utf8_lossy(&enabled_out.stderr)
                .trim()
                .to_string()
        } else {
            stdout
        }
    };

    let active = {
        let stdout = String::from_utf8_lossy(&active_out.stdout)
            .trim()
            .to_string();
        if stdout.is_empty() {
            String::from_utf8_lossy(&active_out.stderr)
                .trim()
                .to_string()
        } else {
            stdout
        }
    };

    println!("platform: linux");
    println!("service_name: {}", args.service_name);
    println!("unit_name: {}", unit_name);
    println!("unit_path: {}", unit_path.display());
    println!("unit_exists: {}", unit_path.exists());
    println!("enabled: {}", enabled);
    println!("active: {}", active);

    Ok(())
}

fn spawn_session(
    args: &Args,
    cwd: Option<String>,
    command: Option<String>,
    cols: u16,
    rows: u16,
    tx: mpsc::UnboundedSender<InternalEvent>,
) -> anyhow::Result<ActiveSession> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let shell = pick_shell(args);
    let mut cmd = CommandBuilder::new(shell.clone());

    // When running as a background service (launchd/systemd user), TERM may be unset.
    // Setting TERM ensures commands like `clear` and full-screen TUIs work correctly.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    if let Some(cwd) = cwd.as_deref().and_then(normalize_cwd) {
        cmd.cwd(cwd);
    } else if cwd.as_deref().is_some_and(|c| !c.trim().is_empty()) {
        warn!(
            "ignoring invalid cwd, falling back to shell default: {:?}",
            cwd
        );
    }

    if let Some(command) = command {
        cmd.arg("-lc");
        cmd.arg(command);
    }

    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let child = pair.slave.spawn_command(cmd)?;

    let session_id = next_session_id();
    let id_for_output = session_id.clone();
    let id_for_exit = session_id.clone();
    let tx_output = tx.clone();

    thread::spawn(move || {
        let mut buf = vec![0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = tx_output.send(InternalEvent::Output {
                        session_id: id_for_output.clone(),
                        chunk: buf[..n].to_vec(),
                    });
                }
                Err(_) => break,
            }
        }
    });

    let killer = child.clone_killer();
    let tx_exit = tx.clone();
    thread::spawn(move || {
        let mut child = child;
        let (code, signal) = match child.wait() {
            Ok(status) => {
                let code = status.exit_code() as i32;
                let signal = status.signal().map(|s| s.to_string());
                (code, signal)
            }
            Err(_) => (-1, Some("wait-error".to_string())),
        };

        let _ = tx_exit.send(InternalEvent::Exit {
            session_id: id_for_exit,
            code,
            signal,
        });
    });

    Ok(ActiveSession {
        id: session_id,
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        killer,
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "logseq_shelld=info,tower_http=info".to_string()),
        )
        .init();

    let args = Args::parse();

    let service_action_count = [
        args.install_service,
        args.uninstall_service,
        args.service_status,
    ]
    .into_iter()
    .filter(|x| *x)
    .count();

    if service_action_count > 1 {
        bail!("use only one of --install-service, --uninstall-service, or --service-status");
    }

    if args.install_service {
        install_service(&args)?;
        return Ok(());
    }

    if args.uninstall_service {
        uninstall_service(&args)?;
        return Ok(());
    }

    if args.service_status {
        service_status(&args)?;
        return Ok(());
    }

    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse()?;

    let state = AppState { args: args.clone() };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state);

    info!("logseq-shelld listening on ws://{}/ws", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    if let Some(expected) = state.args.token.as_ref() {
        let got = query.get("token");
        if got != Some(expected) {
            return axum::http::StatusCode::UNAUTHORIZED.into_response();
        }
    }

    ws.on_upgrade(move |socket| handle_socket(state, socket))
}

async fn handle_socket(state: AppState, socket: axum::extract::ws::WebSocket) {
    let (mut sender, mut receiver) = socket.split();

    let (internal_tx, mut internal_rx) = mpsc::unbounded_channel::<InternalEvent>();
    let mut active: Option<ActiveSession> = None;

    while let Some(next) = tokio::select! {
        maybe_msg = receiver.next() => maybe_msg.map(Either::Incoming),
        maybe_internal = internal_rx.recv() => maybe_internal.map(Either::Internal),
    } {
        match next {
            Either::Incoming(Ok(Message::Text(text))) => {
                match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(msg) => {
                        if handle_client_msg(&state, msg, &mut active, &internal_tx, &mut sender)
                            .await
                            .is_err()
                        {
                            let _ = sender
                                .send(Message::Text(
                                    json!({"type":"error","message":"request failed"}).to_string(),
                                ))
                                .await;
                        }
                    }
                    Err(e) => {
                        let _ = sender
                            .send(Message::Text(
                                json!({"type":"error","message": format!("invalid message: {e}")})
                                    .to_string(),
                            ))
                            .await;
                    }
                }
            }
            Either::Incoming(Ok(Message::Close(_))) => break,
            Either::Incoming(Ok(_)) => {}
            Either::Incoming(Err(e)) => {
                warn!("websocket receive error: {e}");
                break;
            }
            Either::Internal(InternalEvent::Output { session_id, chunk }) => {
                if active.as_ref().is_some_and(|s| s.id == session_id) {
                    if sender.send(Message::Binary(chunk)).await.is_err() {
                        break;
                    }
                }
            }
            Either::Internal(InternalEvent::Exit {
                session_id,
                code,
                signal,
            }) => {
                if active.as_ref().is_some_and(|s| s.id == session_id) {
                    let _ = sender
                        .send(Message::Text(
                            json!({"type":"exit","sessionId":session_id,"code":code,"signal":signal})
                                .to_string(),
                        ))
                        .await;
                    active = None;
                }
            }
        }
    }

    if let Some(mut s) = active {
        s.close();
    }
}

enum Either {
    Incoming(Result<Message, axum::Error>),
    Internal(InternalEvent),
}

async fn handle_client_msg(
    state: &AppState,
    msg: ClientMsg,
    active: &mut Option<ActiveSession>,
    internal_tx: &mpsc::UnboundedSender<InternalEvent>,
    sender: &mut futures::stream::SplitSink<axum::extract::ws::WebSocket, Message>,
) -> anyhow::Result<()> {
    match msg {
        ClientMsg::Hello { client } => {
            info!("client connected: {:?}", client);
            sender
                .send(Message::Text(
                    json!({"type":"hello","server":"logseq-shelld/0.1.0"}).to_string(),
                ))
                .await?;
        }
        ClientMsg::Spawn {
            cwd,
            command,
            cols,
            rows,
        } => {
            if let Some(mut s) = active.take() {
                s.close();
            }

            let session = spawn_session(
                &state.args,
                cwd,
                command,
                cols.unwrap_or(80),
                rows.unwrap_or(24),
                internal_tx.clone(),
            )?;

            let session_id = session.id.clone();
            *active = Some(session);

            sender
                .send(Message::Text(
                    json!({"type":"ready","sessionId":session_id}).to_string(),
                ))
                .await?;
        }
        ClientMsg::Input { session_id, data } => {
            if let Some(active_session) = active.as_ref() {
                if session_id.as_deref() == Some(active_session.id.as_str()) {
                    if let Ok(mut w) = active_session.writer.lock() {
                        w.write_all(data.as_bytes())?;
                        w.flush()?;
                    }
                }
            }
        }
        ClientMsg::Resize {
            session_id,
            cols,
            rows,
        } => {
            if let Some(active_session) = active.as_ref() {
                if session_id.as_deref() == Some(active_session.id.as_str()) {
                    if let Ok(master) = active_session.master.lock() {
                        master.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        })?;
                    }
                }
            }
        }
        ClientMsg::Close { session_id } => {
            if let Some(active_session) = active.as_ref() {
                if session_id.as_deref() == Some(active_session.id.as_str()) {
                    if let Some(mut s) = active.take() {
                        s.close();
                    }
                }
            }
        }
        ClientMsg::Ping => {
            sender
                .send(Message::Text(json!({"type":"pong"}).to_string()))
                .await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ClientMsg;

    #[test]
    fn parse_spawn_message() {
        let raw = r#"{"type":"spawn","cwd":"/tmp","command":"echo hi","cols":100,"rows":30}"#;
        let msg: ClientMsg = serde_json::from_str(raw).expect("must parse");
        match msg {
            ClientMsg::Spawn {
                cwd,
                command,
                cols,
                rows,
            } => {
                assert_eq!(cwd.as_deref(), Some("/tmp"));
                assert_eq!(command.as_deref(), Some("echo hi"));
                assert_eq!(cols, Some(100));
                assert_eq!(rows, Some(30));
            }
            _ => panic!("unexpected variant"),
        }
    }
}
