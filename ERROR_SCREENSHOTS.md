# Error Screenshot Management

## Overview

Error screenshots are automatically captured when the scraper encounters exceptions. They're saved to `screenshots/errors/` with associated metadata for easy debugging.

## 📁 Folder Structure

```
screenshots/
├── errors/
│   ├── error_DISCOVER_MPS_2025-05-14T10-30-45-123Z.png     # Screenshot
│   ├── error_DISCOVER_MPS_2025-05-14T10-30-45-123Z.json    # Metadata
│   ├── error_PARSE_MEMBER_DETAIL_2025-05-14T10-35-20-456Z.png
│   ├── error_PARSE_MEMBER_DETAIL_2025-05-14T10-35-20-456Z.json
│   └── error_report.html                                    # Error report (generated)
└── debug/
    └── debug_screenshots_*.png                              # Optional debug screenshots
```

## 📸 What's Captured

Each error screenshot includes:

### Screenshot File (`.png`)
- Full-page screenshot of the browser state when error occurred
- Helpful for visual debugging (see what was on screen)

### Metadata File (`.json`)
```json
{
  "timestamp": "2025-05-14T10:30:45.123Z",
  "jobName": "DISCOVER_MPS",
  "url": "https://www.parliament.go.ke/the-national-assembly/mps",
  "errorMessage": "Timeout waiting for selector",
  "screenshotPath": "/full/path/to/screenshot.png",
  "pageTitle": "Members of Parliament",
  "pageUrl": "https://www.parliament.go.ke/the-national-assembly/mps"
}
```

## 🛠️ npm Scripts

### View Error Statistics
```bash
npm run screenshot:analyze
```
Shows breakdown of errors by job type and date:
```
📊 Error Screenshot Statistics: {
  "totalErrors": 5,
  "by_job": {
    "DISCOVER_MPS": 2,
    "PARSE_MEMBER_DETAIL": 3
  },
  "by_date": {
    "2025-05-14": 5
  }
}
```

### Generate HTML Error Report
```bash
npm run screenshot:report
```
Creates `screenshots/errors/error_report.html` with:
- All error screenshots displayed
- Error messages and context
- Statistics by job and date
- Linked metadata for each error

Open in browser: `file:///path/to/scraper/screenshots/errors/error_report.html`

### List Recent Errors
```bash
npm run screenshot:list
```
Shows last 10 error screenshots with timestamps:
```
📸 Error Screenshots: 5
  - error_DISCOVER_MPS_2025-05-14T10-30-45-123Z.png 2025-05-14T10:30:45.123Z
  - error_PARSE_MEMBER_DETAIL_2025-05-14T10-35-20-456Z.png 2025-05-14T10:35:20.456Z
```

### Clean Old Error Screenshots
```bash
npm run screenshot:clean
```
Removes screenshots older than 30 days:
```
✅ Cleaned up 12 old screenshots
```

## 🔍 Debugging Workflow

### 1. Check if errors occurred
```bash
npm run screenshot:list
```

### 2. Analyze what errors occurred
```bash
npm run screenshot:analyze
```

### 3. Generate detailed report
```bash
npm run screenshot:report
```

### 4. Open HTML report in browser
```bash
# Windows
start screenshots/errors/error_report.html

# Mac
open screenshots/errors/error_report.html

# Linux
xdg-open screenshots/errors/error_report.html
```

## 📊 Error Report Features

The generated HTML report includes:

- **Statistics Section**: Total errors, breakdown by job type
- **Error Details**: For each error:
  - Job name and timestamp
  - Error message
  - Full-page screenshot
  - Page title and URL
  - Link to raw metadata JSON
- **Sortable/Filterable**: Easy to find specific errors

## 🔄 Integration Points

Error screenshots are automatically captured in:

1. **DISCOVER_MPS** - When discovering new MPs fails
2. **PARSE_MEMBER_DETAIL** - When parsing individual member details fails
3. **PROCESS_MP_LIST_PDF** - When processing PDF list fails
4. **DISCOVER_GOVERNORS** - When discovering governors fails
5. **PARSE_GOVERNOR_DETAIL** - When parsing governor details fails
6. **Main Worker** - Any unhandled error in the worker

Each capture includes:
- Full page screenshot
- Error message and context
- Job name and URL
- Timestamp and metadata

## 💡 Use Cases

### Finding Root Causes
```bash
# 1. See screenshots of what failed
npm run screenshot:report

# 2. Look at the actual page state when error occurred
# 3. Use browser DevTools to inspect HTML
```

### Monitoring Error Trends
```bash
# Run daily to check for patterns
npm run screenshot:analyze

# More MPS errors than governor errors?
# Parser broke for specific URLs?
# Systematic issues vs random timeouts?
```

### Cleanup
```bash
# Keep recent errors for debugging
# Remove old ones to save disk space
npm run screenshot:clean
```

## 📝 Manual Screenshot Capture

To capture screenshots during development:

```typescript
import { screenshotService } from './src/services/screenshotService';

// Capture for debugging (not an error)
await screenshotService.captureDebugScreenshot(page, 'before_parsing');

// Capture as error (with metadata)
await screenshotService.captureErrorScreenshot(
  page,
  'Custom error message',
  'CUSTOM_JOB',
  'https://example.com'
);
```

## 🗂️ File Organization

All error screenshots are organized in `screenshots/errors/` with format:
```
error_{JOB_NAME}_{TIMESTAMP}.png
error_{JOB_NAME}_{TIMESTAMP}.json
```

This makes it easy to:
- Find errors by job type
- Sort chronologically
- Match screenshots with metadata
- Bulk operations (delete by date, etc.)

## 🧹 Cleanup Strategy

### Keep Last 7 Days
```bash
npm run screenshot:clean  # Clears anything > 30 days old
```

### Manual Cleanup
```bash
# List all errors
npm run screenshot:list

# Remove specific file
rm screenshots/errors/error_DISCOVER_MPS_2025-05-05*.{png,json}

# Clear all errors
rm screenshots/errors/*.{png,json}
```

## 🔗 Related Scripts

```bash
# Check job queue status
npm run checkStatus

# Analyze duplicates
npm run analyzeDuplicates

# Run complete check
npm run checkStatus && npm run screenshot:analyze
```

---

**Note**: Error screenshots help diagnose issues. Combined with logs and metadata, they provide complete visibility into scraper failures.
