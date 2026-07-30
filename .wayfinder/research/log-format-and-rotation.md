# Log File Format and Rotation: Industry Survey

Research into primary sources (official source code, first-party docs, and specifications).

---

## 1. Log File Formats

### npm (v11)

**Format: Plain text with counter-prefixed lines.**

Each line is formatted by `formatWithOptions()` in `lib/utils/format.js`:

```
counter level prefix message\n
```

Example output pattern:
```
0 info npm cli v11.x.x
1 verbose title some log message
2 warn title a warning message
```

- Uses the `proc-log` package for log levels (`info`, `verbose`, `warn`, `error`, `silly`, `http`, `notice`, `timing`).
- A global counter is prepended to every line: `<counter> <level> <title> <message>`.
- ANSI control characters are stripped (except SGR codes) via `STRIP_C01()`.
- Secrets (basic auth passwords, npm tokens) are redacted via `@npmcli/redact`.

**Source:** `npm/cli` repo, `lib/utils/log-file.js:188-194` (`#formatLogItem`), `lib/utils/format.js:42-55`

---

### Terraform (HashiCorp)

**Format: hclog (plain text by default, optional JSON).**

Uses the `go-hclog` structured logging library. Default output is plain text via hclog's standard formatting.

- Set `TF_LOG=JSON` to switch to JSON format (log level TRACE).
- Level format strings: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`.
- Output goes to stderr by default or to a file if `TF_LOG_PATH` is set.
- No counter or index on lines.

**Source:** `hashicorp/terraform` repo, `internal/logging/logging.go:58-73` (`newHCLogger`), HashiCorp docs at `developer.hashicorp.com/terraform/internals/debugging`

---

### Sonarr (v4 develop branch)

**Format: Plain text, pipe-delimited fields via NLog.**

Layout constant from `NzbDroneLogger.cs`:

```
yyyy-MM-dd HH:mm:ss.f|level|logger|message
```

Example:
```
2024-01-15 14:03:22.5|Info|DownloadedEpisodesImportService|Processing 1 files
```

- Uses NLog `FileTarget` with custom `NzbDroneFileTarget` wrapper.
- Console output also supports CLEF (Compact Log Event Format, a JSON-based format) when `SONARR__LOG__CONSOLEFORMAT=Clef` is set.
- File layout for update logs is identical.

**Source:** `Sonarr/Sonarr` repo, `src/NzbDrone.Common/Instrumentation/NzbDroneLogger.cs:18` (`FILE_LOG_LAYOUT`)

---

### Audiobookshelf

**Format: JSON-lines (one JSON object per line).**

Each log line is `JSON.stringify(logObj) + '\n'`. The log object shape:

```json
{
  "timestamp": "2024-01-15 14:03:22.500",
  "source": "LogManager:123",
  "message": "Processing books",
  "levelName": "INFO",
  "level": 2
}
```

- Logs are written to `YYYY-MM-DD.txt` files in `{MetadataPath}/logs/daily/`.
- Fatal crashes additionally write to `{MetadataPath}/logs/crash_logs.txt`.
- Console output prefix: `[YYYY-MM-DD HH:mm:ss.SSS] LEVEL: message`.

**Source:** `advplyr/audiobookshelf` repo, `server/Logger.js:131` (`#logToFileAndListeners`), `server/objects/DailyLog.js:57-59` (`appendLog`)

---

### Jellyfin

**Format: Serilog-formatted plain text.**

Serilog output template (from the fallback/default in `InitializeLoggingFramework`):

```
[{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz}] [{Level:u3}] [{ThreadId}] {SourceContext}: {Message}{NewLine}{Exception}
```

Example:
```
[2024-01-15 14:03:22.500 +00:00] [INF] [12] MediaBrowser.MediaEncoding.Encoder.MediaEncoder: Starting ffprobe
```

- Uses Serilog with `Serilog.Extensions.Logging`.
- Primary configuration is loaded from `logging.default.json` (embedded resource, configured via Serilog settings config) and can be overridden by `logging.json`.
- Console output uses a similar format but with a shorter timestamp (`HH:mm:ss`).

**Source:** `jellyfin/jellyfin` repo, `Jellyfin.Server/Helpers/StartupHelpers.cs:141-153` (fallback `LoggerConfiguration`), `Jellyfin.Server/Program.cs:58-59` (log config file names)

---

### Plex Media Server

**Format: Proprietary plain text (closed source).**

Plex is closed source. The official support documentation confirms log files are plain text `.log` files but does not provide the exact logging format. The primary sources are the support articles.

**Source:** Plex support article "Plex Media Server Logs" at `support.plex.tv/articles/200250417-plex-media-server-log-files/`

---

## 2. Log Rotation and Cleanup Timing

### npm

**Rotation: Per-write (event count-based). Cleanup: At startup (`load()`).**

- A new log file is opened after `MAX_LOGS_PER_FILE` events (default 50,000).
- Max `MAX_FILES_PER_PROCESS` files per run (default 5).
- Cleanup happens in `#cleanLogs()` called from `load()` — deletes old log files when total count exceeds `logs-max` (configurable, defaults to `Infinity`).
- Oldest files are deleted first.

**Source:** `npm/cli` repo, `lib/utils/log-file.js:82-85` (`load`), `127-136` (`#logHandler` rotation), `164-201` (`#cleanLogs`)

---

### Terraform

**Rotation: None.**

- Terraform does not perform any log rotation. If `TF_LOG_PATH` is set, logs are appended to that single file indefinitely.
- No cleanup mechanism exists in Terraform itself. Users must manage log files externally.

**Source:** `hashicorp/terraform` repo, `internal/logging/logging.go:58-73` (opens file with `O_CREAT|O_RDWR|O_APPEND`, no rotation logic)

---

### Sonarr

**Rotation: Per-write (size-based, via NLog).**

- `ArchiveAboveSize = 1.Megabytes()` — when a log file exceeds 1 MB, NLog rolls it.
- `MaxArchiveFiles` limits: 5 for info file, 50 for debug/trace files.
- `EnableFileDelete = true` — old archive files are automatically deleted when they exceed the max count.
- `ArchiveNumbering = ArchiveNumberingMode.Rolling` — sequential numbering.
- NLog checks size on every write (since `KeepFileOpen = false` and `ConcurrentWrites = false`).

**Source:** `Sonarr/Sonarr` repo, `src/NzbDrone.Common/Instrumentation/NzbDroneLogger.cs:119-131` (`RegisterAppFile`)

---

### Audiobookshelf

**Rotation: Per-write (day-change detection) + cleanup at startup.**

- **Daily rotation:** Each write via `logToFile()` checks if the day changed (`this.currentDailyLog.id !== DailyLog.getCurrentDateString()`). If so, creates a new DailyLog. Then if total files exceed `loggerDailyLogsToKeep` (default 7), removes the oldest.
- **Startup cleanup:** During `init()`, after scanning existing log files, if count exceeds `loggerDailyLogsToKeep`, deletes the oldest until within limit.
- **Format:** Files named `YYYY-MM-DD.txt`.

**Source:** `advplyr/audiobookshelf` repo, `server/managers/LogManager.js:45-50` (init cleanup), `132-138` (per-write day-roll cleanup)

---

### Jellyfin

**Rotation: Per-day (via Serilog file sink).**

- Default fallback config uses `rollingInterval: RollingInterval.Day` on the Serilog file sink.
- The primary config (`logging.default.json`) is loaded via `ReadFrom.Configuration()`, and the default bundled Serilog config also uses rolling file sink configuration.
- Files are named `log_YYYYMMDD.log` (default Serilog convention with `RollingInterval.Day`).
- No explicit retention limit or automatic cleanup was found in the fallback config or StartupHelpers — retention is either handled by Serilog's built-in retained file count (if configured) or left to the operator.

**Source:** `jellyfin/jellyfin` repo, `Jellyfin.Server/Helpers/StartupHelpers.cs:147` (`rollingInterval: RollingInterval.Day`), Jellyfin docs at `jellyfin.org/docs/general/administration/configuration/#log-directory`

---

### Plex

**Rotation: Likely size-based (closed source).**

Per official support docs, Plex maintains a rolling set of log files: `Plex Media Server.log`, `Plex Media Server.log.1`, through `.log.5`. The exact rotation trigger and timing are not documented in the public primary source.

**Source:** Plex support article "Plex Media Server Logs" at `support.plex.tv/articles/200250417-plex-media-server-log-files/`

---

## 3. XDG Base Directory Specification

**Source:** `specifications.freedesktop.org/basedir-spec/latest/` (Version 0.8, May 2021)

### Relevant State/Log Directories

- **`$XDG_STATE_HOME`** (default: `~/.local/state`) — for state data that persists between restarts but is "not important or portable enough" for `$XDG_DATA_HOME`. Explicitly mentions logs as a valid use: "actions history (logs, history, recently used files, …), current state of the application that can be reused on a restart."

- **`$XDG_CACHE_HOME`** (default: `~/.cache`) — for "non-essential (cached) data."

- **`$XDG_RUNTIME_DIR`** — for runtime files (sockets, pipes). "Files in this directory MAY be subjected to periodic clean-up. To ensure that your files are not removed, they should have their access time timestamp modified at least once every 6 hours of monotonic time or the 'sticky' bit should be set on the file." The directory itself MUST be removed on logout.

### Cleanup Timing

The XDG spec does **not** specify when applications should clean their own log or state files. It only:

1. Defines directory locations and fallback defaults.
2. Says `$XDG_RUNTIME_DIR` files *may* be periodically cleaned by the system (with a 6-hour atime protection window).
3. Requires `$XDG_RUNTIME_DIR` to be removed on logout.

There is no specification-level guidance on when log rotation or cleanup should occur. This is left entirely to application developers.

---

## 4. Summary of Findings

| Tool           | Format              | Rotation/Cleanup Timing                    |
|----------------|---------------------|--------------------------------------------|
| npm            | Plain text (prefixed) | Per-write rotate + startup cleanup       |
| Terraform      | hclog (text or JSON)  | None (single file append)                |
| Sonarr         | Plain text (pipe-delim) | Per-write (1 MB size trigger)          |
| Audiobookshelf | **JSON-lines**       | **Per-write (day change) + startup cleanup** |
| Jellyfin       | Plain text (Serilog) | Per-day (Serilog rolling interval)        |
| Plex           | Plain text (assumed) | Rolling files (`.log.1`–`.log.5`)         |

### Consensus

- **Format:** The majority of tools use **plain text with timestamped lines** (npm, Terraform, Sonarr, Jellyfin, Plex). Audiobookshelf is the outlier with **JSON-lines**, which offers machine-parseability at the cost of human readability.
- **Cleanup timing:** Two patterns dominate:
  1. **Startup cleanup** (npm, Audiobookshelf) — scan existing files on init, remove oldest if over limit.
  2. **Per-write rotation** (npm, Sonarr, Audiobookshelf) — check on each write whether to roll (by size, event count, or day change) and evict old files inline.

### Recommendations

- **Format:** Plain timestamped text is the established convention and simplest to implement. JSON-lines is the better long-term choice if machine consumption (log aggregation, structured search) is expected — it's what Audiobookshelf already uses.
- **Cleanup timing:** **Startup** is the safer minimum (catches leftovers from crashes, simple to implement). **Startup + per-write** (as Audiobookshelf and npm do) is the most robust: startup handles crashed/interrupted runs, per-write handles long-running processes that would exceed limits mid-session. Size-based rotation (as Sonarr does) is harder to implement correctly but prevents unbounded single-file growth within a single session.
