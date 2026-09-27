use std::sync::{atomic::AtomicBool, Arc, Mutex};
use tokio::sync::watch;

// ── SSE state ────────────────────────────────────────────────────

/// Holds the cancellation handle for the background SSE task.
pub struct SseHandle(pub Mutex<Option<watch::Sender<bool>>>);

/// Tracks whether the OAuth callback server is already running.
#[derive(Clone)]
pub struct AuthServerRunning(pub Arc<Mutex<bool>>);

/// Signals the OAuth callback server thread to stop waiting for a callback.
#[derive(Clone)]
pub struct AuthServerStop(pub Arc<AtomicBool>);

// ── System monitor state ─────────────────────────────────────────

/// Data that never changes between polls — cached on first call.
#[derive(Clone)]
pub struct StaticSystemInfo {
    pub cpu_name: String,
    pub cpu_cores: usize,
    pub os_name: String,
    pub hostname: String,
    pub gpu_name: Option<String>,
    pub gpu_vram_total: Option<u64>,
    /// Resolved GPU sysfs device path (AMD), if any.
    pub gpu_sysfs_device: Option<std::path::PathBuf>,
    /// Whether nvidia-smi is available (checked once).
    pub has_nvidia_smi: bool,
    /// Windows: the LUID string of the primary GPU adapter
    /// (e.g. "luid_0x00000000_0x00017BAA_phys_0"). Used to filter
    /// the per-process perf counters down to the discrete GPU.
    /// Set on first poll, then reused.
    #[cfg(windows)]
    pub gpu_luid: Option<String>,
}

/// Dynamic GPU values read each poll.
#[derive(Default)]
pub struct GpuDynamic {
    pub usage: Option<f64>,
    pub vram_used: Option<u64>,
    pub power_watts: Option<f64>,
    pub power_cap_watts: Option<f64>,
    pub clock_mhz: Option<u64>,
}

/// Persistent system info instances — refreshed on each poll.
/// Wrapped in Arc so it can be sent into `spawn_blocking`.
pub struct SysInfoInner {
    pub sys: Mutex<sysinfo::System>,
    pub components: Mutex<sysinfo::Components>,
    pub networks: Mutex<sysinfo::Networks>,
    /// Populated on first poll, then reused.
    pub static_info: Mutex<Option<StaticSystemInfo>>,
}

pub struct SysInfoState(pub Arc<SysInfoInner>);
