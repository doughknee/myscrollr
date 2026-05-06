use crate::state::{GpuDynamic, StaticSystemInfo, SysInfoInner, SysInfoState};

/// Build a `std::process::Command` for `name` that won't pop a
/// console window on Windows. No-op on every other platform.
///
/// Why this exists: on Windows, `std::process::Command::new(...)`
/// inherits its parent's console handle (or creates one if the parent
/// has none, e.g. a GUI app like ours). Every spawn briefly flashes a
/// `cmd.exe` window. The System Monitor widget polls GPU stats via
/// `nvidia-smi` on a 1-2 second cadence, so users on Windows with an
/// NVIDIA GPU saw the console flash open and close constantly
/// (Daniel reported this as ticket #484052).
///
/// `CREATE_NO_WINDOW = 0x08000000` is a Windows-specific creation flag
/// that suppresses the console window. The `creation_flags` method
/// only exists in `std::os::windows::process::CommandExt` so the
/// import + call is gated on `cfg(windows)`. On macOS/Linux the
/// returned Command is identical to `Command::new(name)`.
fn quiet_command(name: &str) -> std::process::Command {
    // The `mut` is only needed on Windows where we call
    // `cmd.creation_flags(...)` below. The `#[allow(unused_mut)]`
    // silences the harmless warning on macOS/Linux without breaking
    // Windows builds.
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(name);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: prevents the spawned process from
        // creating/inheriting a console window. See:
        // https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Probe GPU once: find the sysfs device path, resolve the name and
/// VRAM total, and check whether nvidia-smi is available.  Called only
/// on the first poll; the results are cached in `StaticSystemInfo`.
fn probe_gpu_static() -> (Option<std::path::PathBuf>, Option<String>, Option<u64>, bool) {
    // Try AMD/Intel sysfs first
    let mut best: Option<(std::path::PathBuf, f64)> = None;
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let fname = entry.file_name();
            let s = fname.to_string_lossy();
            if s.starts_with("card") && !s.contains('-') {
                let dev = entry.path().join("device");
                if let Some(usage) = read_sysfs_f64(&dev, "gpu_busy_percent") {
                    let dominated = best.as_ref().is_none_or(|(_, u)| usage > *u);
                    if dominated {
                        best = Some((dev, usage));
                    }
                }
            }
        }
    }

    if let Some((dev, _)) = best {
        let name = std::fs::read_to_string(dev.join("product_name"))
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| gpu_name_from_lspci(&dev));
        let vram_total = read_sysfs_u64(&dev, "mem_info_vram_total");
        return (Some(dev), name, vram_total, false);
    }

    // Fallback: try nvidia-smi once for static values
    if let Ok(out) = quiet_command("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
    {
        if out.status.success() {
            let line = String::from_utf8_lossy(&out.stdout);
            let f: Vec<&str> = line.trim().splitn(2, ", ").collect();
            let name = f.first().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            let vram = f.get(1).and_then(|s| s.trim().parse::<u64>().ok()).map(|m| m * 1024 * 1024);
            return (None, name, vram, true);
        }
    }

    (None, None, None, false)
}

/// Read dynamic GPU values from sysfs (AMD/Intel).
fn read_gpu_dynamic_sysfs(dev: &std::path::Path) -> GpuDynamic {
    let (power_watts, power_cap_watts) = read_gpu_power(dev);
    GpuDynamic {
        usage: read_sysfs_f64(dev, "gpu_busy_percent"),
        vram_used: read_sysfs_u64(dev, "mem_info_vram_used"),
        power_watts,
        power_cap_watts,
        clock_mhz: read_gpu_clock(dev),
    }
}

/// Read dynamic GPU values from nvidia-smi.
///
/// This is the hot path called on every System Monitor poll. On
/// Windows, each spawn was creating a console window (the bug behind
/// ticket #484052). `quiet_command` adds CREATE_NO_WINDOW to suppress
/// that on Windows; behavior is unchanged on Linux/macOS.
fn read_gpu_dynamic_nvidia() -> GpuDynamic {
    if let Ok(out) = quiet_command("nvidia-smi")
        .args([
            "--query-gpu=utilization.gpu,memory.used,power.draw,power.limit,clocks.current.graphics",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if out.status.success() {
            let line = String::from_utf8_lossy(&out.stdout);
            let f: Vec<&str> = line.trim().splitn(5, ", ").collect();
            return GpuDynamic {
                usage: f.first().and_then(|s| s.trim().parse().ok()),
                vram_used: f.get(1).and_then(|s| s.trim().parse::<u64>().ok()).map(|m| m * 1024 * 1024),
                power_watts: f.get(2).and_then(|s| s.trim().parse().ok()),
                power_cap_watts: f.get(3).and_then(|s| s.trim().parse().ok()),
                clock_mhz: f.get(4).and_then(|s| s.trim().parse().ok()),
            };
        }
    }
    GpuDynamic::default()
}

/// Read GPU power from hwmon (microwatts → watts).
fn read_gpu_power(dev: &std::path::Path) -> (Option<f64>, Option<f64>) {
    // hwmon directory under the device contains power1_average / power1_cap
    let hwmon_dir = dev.join("hwmon");
    let entries = match std::fs::read_dir(&hwmon_dir) {
        Ok(e) => e,
        Err(_) => return (None, None),
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let avg = read_sysfs_u64(&dir, "power1_average").map(|uw| uw as f64 / 1_000_000.0);
        let cap = read_sysfs_u64(&dir, "power1_cap").map(|uw| uw as f64 / 1_000_000.0);
        if avg.is_some() {
            return (avg, cap);
        }
    }
    (None, None)
}

/// Parse the active GPU clock from pp_dpm_sclk (AMD sysfs).
/// Lines look like: "0: 500Mhz", "1: 1415Mhz *" — the active state has *.
fn read_gpu_clock(dev: &std::path::Path) -> Option<u64> {
    let content = std::fs::read_to_string(dev.join("pp_dpm_sclk")).ok()?;
    for line in content.lines() {
        if line.contains('*') {
            // Extract number before "Mhz"
            return line.split_whitespace()
                .find(|w| w.ends_with("Mhz"))
                .and_then(|w| w.trim_end_matches("Mhz").parse().ok());
        }
    }
    None
}

/// Read a u64 from a sysfs file.
fn read_sysfs_u64(dir: &std::path::Path, name: &str) -> Option<u64> {
    std::fs::read_to_string(dir.join(name))
        .ok()
        .and_then(|v| v.trim().parse().ok())
}

/// Read an f64 from a sysfs file.
fn read_sysfs_f64(dir: &std::path::Path, name: &str) -> Option<f64> {
    std::fs::read_to_string(dir.join(name))
        .ok()
        .and_then(|v| v.trim().parse().ok())
}

/// Read the max CPU frequency across all cores (kHz → MHz).
fn read_cpu_freq_mhz() -> Option<u64> {
    let mut max_khz: u64 = 0;
    if let Ok(entries) = std::fs::read_dir("/sys/devices/system/cpu") {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let s = name.to_string_lossy();
            if s.starts_with("cpu") && s[3..].chars().all(|c| c.is_ascii_digit()) {
                if let Some(khz) = read_sysfs_u64(
                    &entry.path().join("cpufreq"),
                    "scaling_cur_freq",
                ) {
                    if khz > max_khz {
                        max_khz = khz;
                    }
                }
            }
        }
    }
    if max_khz > 0 { Some(max_khz / 1000) } else { None }
}

/// Resolve a GPU's marketing name via `lspci -vmms <slot>`.
/// Reads the PCI slot from the device's `uevent` file, then parses the
/// `SDevice` line (specific product name) with a fallback to `Device`.
fn gpu_name_from_lspci(dev_path: &std::path::Path) -> Option<String> {
    let uevent = std::fs::read_to_string(dev_path.join("uevent")).ok()?;
    let slot = uevent
        .lines()
        .find_map(|l| l.strip_prefix("PCI_SLOT_NAME="))?;

    // lspci is Linux-only and won't be reached on Windows (no PCI sysfs),
    // but use quiet_command for consistency / future-proofing.
    let out = quiet_command("lspci")
        .args(["-vmms", slot])
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&out.stdout);

    // Prefer SDevice (e.g. "NITRO+ RX 7900 XTX Vapor-X") over the
    // generic Device line, but skip placeholder values like "Device XXXX".
    let sdevice = extract_lspci_field(&text, "SDevice");
    if let Some(ref sd) = sdevice {
        let low = sd.to_lowercase();
        if !low.starts_with("device ") && !low.is_empty() {
            return sdevice;
        }
    }

    extract_lspci_field(&text, "Device")
}

/// Parse a single "Key:\tValue" field from `lspci -vmm` output.
fn extract_lspci_field(text: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:\t");
    text.lines()
        .find_map(|l| l.strip_prefix(&prefix))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Return a snapshot of CPU, memory, GPU, temperatures, network, and
/// system metadata.  Static values (names, totals, OS info) are cached
/// on first call.  Runs on a blocking thread to keep the IPC loop free.
#[tauri::command]
pub async fn get_system_info(
    state: tauri::State<'_, SysInfoState>,
) -> Result<serde_json::Value, String> {
    let inner = state.0.clone();
    tokio::task::spawn_blocking(move || get_system_info_blocking(&inner))
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))?
}

/// All the actual work — runs inside `spawn_blocking`.
fn get_system_info_blocking(inner: &SysInfoInner) -> Result<serde_json::Value, String> {
    let mut sys = inner.sys.lock().map_err(|e| format!("lock: {e}"))?;
    let mut components = inner.components.lock().map_err(|e| format!("lock: {e}"))?;
    let mut networks = inner.networks.lock().map_err(|e| format!("lock: {e}"))?;

    sys.refresh_cpu_usage();
    sys.refresh_memory();
    components.refresh(false);
    networks.refresh(false);

    // ── Static info (cached after first poll) ────────────────────
    let mut static_guard = inner.static_info.lock().map_err(|e| format!("lock: {e}"))?;
    let cached = static_guard.get_or_insert_with(|| {
        let cpu_name = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();
        let cpu_cores = sys.cpus().len();
        let os_name = format!(
            "{} {}",
            sysinfo::System::name().unwrap_or_default(),
            sysinfo::System::os_version().unwrap_or_default(),
        );
        let hostname = sysinfo::System::host_name().unwrap_or_default();
        let (gpu_sysfs_device, gpu_name, gpu_vram_total, has_nvidia_smi) = probe_gpu_static();

        StaticSystemInfo {
            cpu_name,
            cpu_cores,
            os_name,
            hostname,
            gpu_name,
            gpu_vram_total,
            gpu_sysfs_device,
            has_nvidia_smi,
        }
    });
    let st = cached.clone();
    drop(static_guard);

    // ── Dynamic CPU ──────────────────────────────────────────────
    let cpu_usage = if st.cpu_cores == 0 {
        0.0
    } else {
        let total: f32 = sys.cpus().iter().map(|c| c.cpu_usage()).sum();
        (total / st.cpu_cores as f32) as f64
    };
    let cpu_freq_mhz = read_cpu_freq_mhz();

    // ── Dynamic GPU ──────────────────────────────────────────────
    let gpu = if let Some(ref dev) = st.gpu_sysfs_device {
        read_gpu_dynamic_sysfs(dev)
    } else if st.has_nvidia_smi {
        read_gpu_dynamic_nvidia()
    } else {
        GpuDynamic::default()
    };

    // ── Temperatures ─────────────────────────────────────────────
    let comp_info: Vec<serde_json::Value> = components
        .iter()
        .filter(|c| c.temperature().is_some_and(|t| t > 0.0))
        .map(|c| {
            serde_json::json!({
                "label": c.label(),
                "temp": c.temperature().unwrap_or(0.0),
                "max": c.max().unwrap_or(0.0),
                "critical": c.critical(),
            })
        })
        .collect();

    // ── Memory (read before dropping sys lock) ─────────────────
    let mem_total = sys.total_memory();
    let mem_used = sys.used_memory();

    // ── Network ──────────────────────────────────────────────────
    let net_info: Vec<serde_json::Value> = networks
        .iter()
        .filter(|(name, data)| {
            if name.starts_with("lo") { return false; }
            if name.starts_with("docker")
                || name.starts_with("veth")
                || name.starts_with("br-")
                || name.starts_with("virbr")
            {
                return false;
            }
            data.received() > 0 || data.transmitted() > 0
                || data.total_received() > 0
        })
        .map(|(name, data)| {
            serde_json::json!({
                "name": name,
                "rxBytes": data.received(),
                "txBytes": data.transmitted(),
            })
        })
        .collect();

    Ok(serde_json::json!({
        "cpuName": st.cpu_name,
        "cpuCores": st.cpu_cores,
        "cpuUsage": cpu_usage,
        "cpuFreqMhz": cpu_freq_mhz,
        "gpuName": st.gpu_name,
        "gpuUsage": gpu.usage,
        "gpuVramTotal": st.gpu_vram_total,
        "gpuVramUsed": gpu.vram_used,
        "gpuPowerWatts": gpu.power_watts,
        "gpuPowerCapWatts": gpu.power_cap_watts,
        "gpuClockMhz": gpu.clock_mhz,
        "memTotal": mem_total,
        "memUsed": mem_used,
        "osName": st.os_name,
        "hostname": st.hostname,
        "uptime": sysinfo::System::uptime(),
        "components": comp_info,
        "network": net_info,
    }))
}
