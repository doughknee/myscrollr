//! Windows-only GPU stats via WMI performance counters.
//!
//! WMI exposes the same counters Task Manager uses for its GPU tab:
//!   - Win32_VideoController: static info (name, VRAM total per adapter)
//!   - Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine:
//!     per-process per-engine utilization %
//!   - Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory:
//!     per-adapter dedicated VRAM usage
//!
//! We pick the adapter with the most dedicated VRAM as "the GPU" —
//! this skips iGPUs and the Microsoft Basic Display Adapter that
//! Windows registers as a fallback driver.

#![cfg(windows)]

use serde::Deserialize;
use wmi::{COMLibrary, WMIConnection};

use crate::state::GpuDynamic;

/// Static info about the primary GPU adapter on the system.
#[derive(Debug)]
pub struct GpuStatic {
    pub name: Option<String>,
    /// VRAM size in bytes.
    pub vram_total: Option<u64>,
    /// The adapter's LUID string, used to filter perf counters.
    /// Format: `luid_0xHHHHHHHH_0xHHHHHHHH_phys_N`
    pub luid: Option<String>,
}

// ── WMI deserialization structs ──────────────────────────────────

#[allow(non_snake_case, non_camel_case_types, dead_code)]
#[derive(Deserialize, Debug)]
struct Win32_VideoController {
    Name: Option<String>,
    AdapterRAM: Option<u32>,
    /// PNPDeviceID lets us match this controller to a perf-counter LUID.
    PNPDeviceID: Option<String>,
}

#[allow(non_snake_case, non_camel_case_types)]
#[derive(Deserialize, Debug)]
struct Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine {
    Name: String,
    UtilizationPercentage: u64,
}

#[allow(non_snake_case, non_camel_case_types, dead_code)]
#[derive(Deserialize, Debug)]
struct Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory {
    Name: String,
    DedicatedUsage: u64,
    SharedUsage: u64,
}

// Cached WMI connection per blocking-pool thread.
//
// COMLibrary + WMIConnection are pinned to the thread that created
// them (COM apartment affinity). tokio's spawn_blocking reuses a
// small pool of threads, so we use thread-local storage to keep a
// long-lived connection per worker — first call on a thread pays the
// ~100-200 ms setup cost, every subsequent call on that same thread
// reuses the existing connection.
//
// Wrapped in an extra Option<Result> so a failed init isn't retried
// indefinitely (the per-thread state stays Err and we return early).
thread_local! {
    static WMI_CONN: std::cell::RefCell<Option<Result<WMIConnection, String>>> =
        std::cell::RefCell::new(None);
}

/// Run `f` with a borrowed reference to the thread-local WMI connection.
/// Initializes the connection on first call for this thread.
fn with_conn<R>(f: impl FnOnce(&WMIConnection) -> R) -> Result<R, String> {
    WMI_CONN.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let result = (|| {
                let com = COMLibrary::new().map_err(|e| format!("COM init: {e}"))?;
                WMIConnection::new(com).map_err(|e| format!("WMI conn: {e}"))
            })();
            *slot = Some(result);
        }
        match slot.as_ref().unwrap() {
            Ok(conn) => Ok(f(conn)),
            Err(e) => Err(e.clone()),
        }
    })
}

/// Probe static GPU info on first poll. Picks the adapter with the
/// most VRAM (skips iGPU and Microsoft Basic Display Adapter).
///
/// Returns (name, vram_bytes, luid). All fields are Option so a
/// failed probe degrades gracefully — the dynamic side will just
/// return all-None.
pub fn probe_static() -> GpuStatic {
    let controllers: Vec<Win32_VideoController> = match with_conn(|c| c.query()) {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            log::warn!("[gpu_win] Win32_VideoController query: {e}");
            return GpuStatic { name: None, vram_total: None, luid: None };
        }
        Err(e) => {
            log::warn!("[gpu_win] connect failed: {e}");
            return GpuStatic { name: None, vram_total: None, luid: None };
        }
    };

    // The primary adapter is the one with the most AdapterRAM (used
    // as a heuristic to skip the iGPU / Microsoft Basic Display
    // Adapter / capture-card pseudo-devices). AdapterRAM is u32 so
    // it truncates at 4GB on cards with more VRAM, but it still
    // sorts correctly because the alternatives are 512MB or 0.
    let primary = match controllers.iter().max_by_key(|c| c.AdapterRAM.unwrap_or(0)) {
        Some(c) => c,
        None => return GpuStatic { name: None, vram_total: None, luid: None },
    };
    let name = primary.Name.clone();

    // For the actual VRAM size we MUST go through DXGI — WMI's
    // AdapterRAM truncates anything over 4GB (it's a u32 in a struct
    // designed in the 32-bit era). DXGI returns a 64-bit value.
    let dxgi_vram = dxgi_vram_for(name.as_deref());

    // 2. Find the matching perf-counter adapter to get the LUID.
    // The "primary" adapter from the perf counters' perspective is
    // the one with the most DedicatedUsage right now — usually the
    // discrete card if anything is running on it.
    let adapters: Vec<Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory> =
        with_conn(|c| c.query()).ok().and_then(|r| r.ok()).unwrap_or_default();

    let luid = adapters
        .into_iter()
        .max_by_key(|a| a.DedicatedUsage)
        .map(|a| a.Name);

    // Final VRAM: prefer DXGI's accurate u64, fall back to WMI's
    // truncated u32 if DXGI lookup failed.
    let vram_total = dxgi_vram.or_else(|| primary.AdapterRAM.map(|v| v as u64));

    log::info!(
        "[gpu_win] primary GPU: name={:?} vram_total={:?} luid={:?}",
        name, vram_total, luid
    );

    GpuStatic { name, vram_total, luid }
}

/// Read dynamic GPU values: total utilization (% across all processes
/// on the 3D engine) and VRAM in use.
pub fn read_dynamic(luid: Option<&str>) -> GpuDynamic {
    let engines: Vec<Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine> =
        match with_conn(|c| c.query()) {
            Ok(Ok(v)) => v,
            _ => return GpuDynamic::default(),
        };

    // GPU utilization matches Task Manager: pick the busiest single
    // engine across ALL engine types (3D, Compute, Copy, Video
    // Codec, etc.) for our adapter. Reasoning:
    //   - Each UtilizationPercentage value is already a % of GPU
    //     time on that engine. We can't add them — they may overlap.
    //   - Different engine types are distinct hardware blocks. A GPU
    //     doing 100% video decode and 0% 3D is "100% busy" from the
    //     user's perspective.
    //   - Task Manager's headline GPU % is this max-across-engines
    //     value. Picking only 3D under-reports during video playback
    //     (browser uses Video Decode for hardware-accelerated HTML5).
    //
    // We take the per-engine max across processes first, then the max
    // across engines. Multiple PIDs hitting the same engine show up
    // as multiple rows with the SAME engine name in the suffix; we
    // group by engine suffix to avoid summing duplicate rows.
    use std::collections::HashMap;
    let mut by_engine: HashMap<&str, u64> = HashMap::new();
    for e in engines.iter() {
        if let Some(want) = luid {
            if !e.Name.contains(want) {
                continue;
            }
        }
        // The engine identity is everything from "_eng_" onwards
        // (e.g. "..._eng_0_engtype_3D"). Same engine across PIDs has
        // the same suffix; we take the max within that group.
        let suffix = match e.Name.find("_eng_") {
            Some(i) => &e.Name[i..],
            None => continue,
        };
        let cur = by_engine.entry(suffix).or_insert(0);
        if e.UtilizationPercentage > *cur {
            *cur = e.UtilizationPercentage;
        }
    }
    let usage_pct = by_engine.values().copied().max().unwrap_or(0);

    let usage = usage_pct.min(100) as f64;

    // VRAM used: look up the adapter memory counter for our LUID.
    let mems: Vec<Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory> =
        with_conn(|c| c.query()).ok().and_then(|r| r.ok()).unwrap_or_default();

    let vram_used = luid.and_then(|want| {
        mems.iter()
            .find(|m| m.Name.contains(want))
            .map(|m| m.DedicatedUsage)
    });

    GpuDynamic {
        usage: Some(usage),
        vram_used,
        // Power/clock not available via WMI on Windows for AMD/Intel.
        // NVIDIA users with nvidia-smi installed take the other code
        // path which does provide these.
        power_watts: None,
        power_cap_watts: None,
        clock_mhz: None,
    }
}


// ─── Registry: accurate VRAM size ─────────────────────────────────
//
// WMI's Win32_VideoController.AdapterRAM is a u32, so it truncates
// at 4GB. The right API for accurate VRAM is DXGI's IDXGIAdapter, but
// that requires extra Win32 crate features we don't otherwise need.
//
// Easier path: the driver writes the actual VRAM size as a QWORD to:
//
//   HKLM\SYSTEM\CurrentControlSet\Control\Class\
//     {4d36e968-e325-11ce-bfc1-08002be10318}\NNNN\
//     HardwareInformation.qwMemorySize
//
// Where {4d36e968...} is the display class GUID and NNNN is a 4-digit
// adapter index. We walk all subkeys, match DriverDesc to our adapter
// name, and read the qword value. This matches what Task Manager
// shows in the Performance > GPU section.

const DISPLAY_CLASS_GUID: &str =
    "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";

/// Read accurate VRAM size in bytes for the GPU whose `DriverDesc`
/// registry value matches `name`. Returns None if no match or any
/// registry call fails.
fn read_vram_from_registry(name: Option<&str>) -> Option<u64> {
    let want = name?;

    // Use `reg query` rather than pulling in a registry crate.
    // Output format (per subkey):
    //   HKEY_LOCAL_MACHINE\...\0000
    //       DriverDesc    REG_SZ    AMD Radeon RX 7900 XTX
    //       HardwareInformation.qwMemorySize    REG_QWORD    0x600000000
    //       ...
    let out = crate::commands::system_info::system_info_quiet_command("reg")
        .args([
            "query",
            &format!("HKLM\\{DISPLAY_CLASS_GUID}"),
            "/s",
            "/f",
            "qwMemorySize",
            "/v",
            "HardwareInformation.qwMemorySize",
        ])
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&out.stdout);

    // Walk the output in subkey blocks. Each block starts with a
    // "HKEY_LOCAL_MACHINE\..." header, then has indented value lines.
    // We need the qwMemorySize value from the block whose DriverDesc
    // matches our adapter name. But /v limits output to JUST the
    // queried value — we don't get DriverDesc. So we have to do TWO
    // queries: first to find candidate subkeys, then per-subkey for
    // DriverDesc and the qword.

    // Simpler approach: iterate the per-block headers (subkey paths
    // like ...\0000, ...\0001), and for each one with a qwMemorySize,
    // separately query DriverDesc.
    let mut subkeys: Vec<String> = Vec::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        if line.starts_with("HKEY_LOCAL_MACHINE") {
            current = Some(line.trim().to_string());
        } else if line.contains("HardwareInformation.qwMemorySize") {
            if let Some(ref sub) = current {
                subkeys.push(sub.clone());
            }
        }
    }

    for sub in subkeys {
        // Query DriverDesc for this subkey
        let desc_out = crate::commands::system_info::system_info_quiet_command("reg")
            .args(["query", &sub, "/v", "DriverDesc"])
            .output()
            .ok()?;
        if !desc_out.status.success() {
            continue;
        }
        let desc_text = String::from_utf8_lossy(&desc_out.stdout);
        let matched = desc_text
            .lines()
            .filter_map(|l| l.split_once("REG_SZ"))
            .map(|(_, v)| v.trim())
            .any(|v| v == want);
        if !matched {
            continue;
        }

        // Query the qword size
        let qw_out = crate::commands::system_info::system_info_quiet_command("reg")
            .args(["query", &sub, "/v", "HardwareInformation.qwMemorySize"])
            .output()
            .ok()?;
        if !qw_out.status.success() {
            continue;
        }
        let qw_text = String::from_utf8_lossy(&qw_out.stdout);
        for line in qw_text.lines() {
            // Format: "    HardwareInformation.qwMemorySize    REG_QWORD    0x600000000"
            if let Some((_, hex)) = line.split_once("REG_QWORD") {
                let hex = hex.trim().trim_start_matches("0x");
                if let Ok(bytes) = u64::from_str_radix(hex, 16) {
                    log::info!(
                        "[gpu_win] registry VRAM for '{}': {} bytes ({} MB)",
                        want, bytes, bytes / 1024 / 1024
                    );
                    return Some(bytes);
                }
            }
        }
    }

    None
}

/// Public helper that the static probe calls.
fn dxgi_vram_for(name: Option<&str>) -> Option<u64> {
    read_vram_from_registry(name)
}