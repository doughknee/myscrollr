use std::sync::OnceLock;
use log::{Level, Log};
use tokio::sync::mpsc;

pub use log::{info, error, warn};

type LogMessage = String;

static LOGGER: OnceLock<AsyncLogger> = OnceLock::new();

pub struct AsyncLogger {
    sender: mpsc::Sender<LogMessage>,
}

impl Log for AsyncLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= Level::Info
    }

    fn log(&self, record: &log::Record) {
        let file_locator = if let Some(file) = record.file() {
            let pat = format!("{}/src/", record.target());
            let stripped = file.strip_prefix(&pat);
            if let Some(filename) = stripped {
                filename
            } else {
                file
            }
        } else {
            "Unknown"
        };

        let line_locator = if let Some(line) = record.line() {
            line.to_string()
        } else {
            "Unknown".to_string()
        };

        let locator = format!("({file_locator} : {line_locator})");

        if self.enabled(record.metadata()) {
            let log_entry = format!(
                "[{}] {} {} {} - {}\n",
                chrono::Local::now(),
                record.level(),
                record.target(),
                locator,
                record.args()
            );

            // When the async channel is full, previously we dropped silently —
            // which meant under load we lost the exact log lines we most needed.
            // Now we at least surface the dropped line on stderr so operators
            // can see we're losing messages and tune `LOG_CHANNEL_CAPACITY`.
            if let Err(tokio::sync::mpsc::error::TrySendError::Full(dropped)) =
                self.sender.try_send(log_entry)
            {
                eprintln!("[LOG-DROPPED] {}", dropped);
            }
        }
    }

    fn flush(&self) {}
}

/// The writer task is stdout-only: long-running pods were filling disk with
/// a `./logs/predictions.log` file that nothing was ever rotating or reading.
/// Coolify/k8s capture stdout, so file output was pure cost. The async
/// channel is kept as-is so logging calls never block on I/O.
pub async fn log_writer_task(mut receiver: mpsc::Receiver<LogMessage>) {
    println!("Starting async log writer task...");
    while let Some(msg) = receiver.recv().await {
        print!("{msg}");
    }
    println!("Log writer task finished.");
}

const LOG_CHANNEL_CAPACITY: usize = 1000;

/// Initialize the global async logger. `RUST_LOG` can override the default
/// level at runtime (e.g. `RUST_LOG=debug` for local troubleshooting); we
/// default to Info so Pro-tier polling doesn't spam gigabytes of Debug
/// lines into the Coolify log aggregator.
pub fn init_async_logger(_log_path: &str) -> Result<(), log::SetLoggerError> {
    let (sender, receiver) = mpsc::channel(LOG_CHANNEL_CAPACITY);

    let logger = AsyncLogger { sender };

    let level = std::env::var("RUST_LOG")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(log::LevelFilter::Info);

    let res = log::set_logger(LOGGER.get_or_init(|| logger))
        .map(|()| log::set_max_level(level));

    if res.is_ok() {
        tokio::spawn(log_writer_task(receiver));
    }

    res
}
