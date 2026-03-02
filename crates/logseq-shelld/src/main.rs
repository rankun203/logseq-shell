use std::{
    collections::HashMap,
    io::{Read, Write},
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};

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

    if let Some(cwd) = cwd {
        cmd.cwd(cwd);
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
