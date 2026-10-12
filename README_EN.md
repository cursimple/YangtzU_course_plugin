# 🎓 Class Schedule Viewer · Yangtze University Plugin

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.32-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Android-lightgrey)

**Automatically fetch course schedule from Yangtze University EAMS System**

[中文文档](README.md) · [Report Issues](../../issues) · [Request Features](../../issues)

</div>

---

## ✨ Features

- 🔄 **Auto Sync** - Automatically fetch schedule via ATrust + EAMS session
- 🔐 **Secure Auth** - Support Yangtze University CAS authentication
- 📅 **Complete Schedule** - Retrieve all semester course data
- ⏰ **Precise Timing** - Include time slots, locations, and teacher info
- 🎯 **Smart Parsing** - Auto-detect course details and weekly arrangements

## 📋 Prerequisites

- **Class Schedule Viewer** App installed
- Yangtze University EAMS account
- Campus network or VPN access

## 🚀 Quick Start

### 1. Install Plugin

Download the latest plugin package (`.zip` file) from the [Releases](../../releases) page, then import it into the Class Schedule Viewer App.

### 2. Authentication

After opening the plugin, you will be redirected to the Yangtze University CAS login page. Enter your student ID and password to complete authentication.

### 3. Sync Schedule

Once logged in, the plugin will automatically:
- Navigate to EAMS course homepage
- Capture course metadata
- Fetch detailed course info for each week
- Generate and commit schedule draft

## 📖 Usage Guide

### Supported Login Methods

| Method | Description |
|--------|-------------|
| CAS Authentication | Login with student ID + password |
| WeChat QR Code | Scan QR code via WeChat |
| ATrust Verification | Auto-handle ATrust secondary verification |

### Course Information

| Field | Description |
|-------|-------------|
| Course Title | Full course name |
| Teacher | Instructor name |
| Location | Classroom/Lab |
| Time | Day of week + time slot |
| Weeks | Week range |

### Time Slot Reference

| Slot | Time |
|------|------|
| Period 1 | 08:00 - 09:35 |
| Period 2 | 10:05 - 11:40 |
| Noon Class | 12:00 - 13:35 |
| Period 3 | 14:00 - 15:35 |
| Period 4 | 16:05 - 17:40 |
| Evening Class | 18:00 - 18:45 |
| Period 5 | 19:00 - 20:35 |
| Period 6 | 20:45 - 22:20 |

## 🔧 FAQ

### Q: Shows "Waiting for Authentication" after login?
A: Make sure you entered the correct student ID and password, or try reopening the plugin.

### Q: Schedule data is incomplete?
A: The plugin will auto-retry fetching. If still incomplete, check your network connection and tap the "Resync" button.

### Q: "Please don't click too fast" message?
A: This is EAMS rate limiting. The plugin will automatically wait and retry. Please be patient.

### Q: Cannot access EAMS system?
A: Ensure you're connected to campus network or VPN, and verify your account status is active.

## 📁 Project Structure

```
plugin-packages/
└── yangtzeu-eams/
    ├── manifest.json      # Plugin configuration
    ├── main.js            # Main program logic
    ├── checksums.json     # Checksum info
    ├── assets/            # Static assets
    ├── datapack/
    │   └── timing.json    # Schedule timing config
    ├── models/            # Data models
    └── ui/
        └── schedule.json  # UI configuration
```

## 🛠️ Development

### Build Plugin Package

```powershell
# Windows PowerShell
.\scripts\pack-plugin.ps1
```

Build output will be in the `dist/` directory.

### Technical Details

- **Web Engine**: System WebView / Chromium
- **Data Capture**: Session-based HTTP packet capture
- **Authentication**: ATrust + CAS unified auth
- **Concurrency**: 2 concurrent requests by default to avoid rate limiting

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🤝 Contributing

Issues and Pull Requests are welcome!

## 🙏 Acknowledgments

Thanks to Yangtze University EAMS for providing the data interface.

---

<div align="center">

**Class Schedule Viewer** © [cursimple](https://github.com/cursimple) · Made with ❤️

</div>

## Timetable display settings

With the paired local CurSimple build and plugin 1.0.35, tap the separate Plugin settings button on the installed plugin card to control midday and evening rows. Both switches default on. Empty rows can be removed; occupied rows stay visible. Switches update the current local timetable immediately, without importing or syncing again. Only timetables imported by this plugin with the complete eight-row Yangtze University format, including midday and evening rows, qualify. Other sources, incomplete formats and legacy timetables without a recorded importer keep all rows visible; the last selected plugin is never treated as proof of origin. For an older plugin import, use Confirm legacy source once in Plugin settings to enable the switches after the complete format check, without signing in or reimporting. The reversible display link belongs only to the reviewed timetable. These settings affect display only and retain course, period-time and reminder data.

After about five seconds without automatic import on the timetable page, Upload schedule is offered and page controls remain available. Incomplete runs retry at the declared interval without duplicating active imports; manual upload waits for a ready draft. Primary and minor grids map periods separately, splitting weekdays and disjoint ranges and respecting row spans and course-list column order.
