# VeriVote Scraper

A Node.js/TypeScript data engine for scraping MP/member information, managing queues with BullMQ, and exposing a REST API for member search and statistics.

## Features

- Express API server with health check and members endpoints
- BullMQ queue-based scraper and push worker
- MongoDB storage for member records
- Redis-based task queueing
- Docker Compose support for MongoDB and Redis
- Manual scrape triggers via API

## Prerequisites

- Node.js 20+ (or compatible version)
- npm
- MongoDB
- Redis

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root with at least:

```env
MONGODB_URI=mongodb://localhost:27017/verivote
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

> The app requires `MONGODB_URI`. Redis defaults to `127.0.0.1:6379` if `REDIS_HOST` and `REDIS_PORT` are not provided.

## Optional Docker Compose

The repository includes `docker-compose.yml` to start MongoDB and Redis:

```bash
docker compose up -d
```

If using Docker Compose, set `MONGODB_URI` to the Mongo container:

```env
MONGODB_URI=mongodb://localhost:27017/verivote
```

## Run the application

### Start only the API server

```bash
npm run server
```

### Start workers

```bash
npm run worker
```

### Start push worker

```bash
npm run push-worker
```

### Start scheduler

```bash
npm run scheduler
```

### Start local development mode
### check the package.json to see how many files run concurrently using the below command
```bash 
npm run dev
```

### Production with PM2

```bash
npm run prod
npm run prod:logs
npm run prod:stop
```

## Export scraped data to JSON

The repository includes `exportData.ts` for exporting all scraped member records from MongoDB to a local JSON file.

1. Ensure your `.env` file contains a valid MongoDB connection string, or use the default:

```env
MONGODB_URI=mongodb://localhost:27017/verivote
```

2. Run the export script:

```bash
npx tsx exportData.ts
```

3. The script writes the exported data to:

```bash
members_export.json
```

> This script connects to MongoDB, fetches all documents from the members collection, and saves them as formatted JSON.

## Check Scraping Status

The repository includes `checkStatus.ts` for monitoring queue progress and database statistics.

Use this to verify:
- All jobs are processed (no jobs stuck in active or waiting queues)
- All required members and their details have been captured
- Queue status (active, waiting, completed, failed jobs)
- Database record counts (total members, MPs, governors)

Run the status check:

```bash
npx tsx checkStatus.ts
```

### Output includes:

**Queue Status:**
- `Active jobs` - Currently processing jobs
- `Waiting jobs` - Jobs queued but not yet processed
- `Completed jobs` - Successfully completed jobs (shows last 1000)
- `Failed jobs` - Failed jobs that need attention (shows last 1000)

**Database Status:**
- `Total members` - Total member records in database
- `MPs` - Count of members with role 'MP'
- `Governors` - Count of members with role 'Governor'

**Expected Totals:**
- MPs: 349 (290 constituency + 47 women + 12 nominated)
- Governors: 47
- Total: 396 members

> When all jobs are done, `Active jobs` and `Waiting jobs` should both be 0, and your database counts should match or exceed the expected totals.

## Handling Duplicate Members

If you notice your MP or Governor count is significantly higher than expected (e.g., 700+ MPs instead of 349), you likely have duplicate records. This can happen if:
- The scraper runs multiple times
- Data is scraped with slight variations (e.g., "John Doe" vs "Hon. John Doe")
- Upsert queries don't have specific enough filters

### Analyze duplicates:

First, understand the scale of the problem:

```bash
npx tsx analyzeDuplicates.ts
```

This shows:
- How many duplicate names exist
- Which MPs/Governors have multiple records
- The difference between total records and unique members

### Remove duplicates:

Clean up the database by removing redundant records:

```bash
npx tsx deduplicateDB.ts
```

This script:
- Groups members by (name, role, county)
- Keeps the most recently updated record
- Deletes all other duplicates
- Shows before/after counts

**Example output:**
```
❌ Duplicate Group: "john doe" (MP in Nairobi)
   └─ Found 3 records:
   ✅ KEEPING: ID=507f... | Updated: 2025-05-14T10:30:00Z
   🗑️ DELETING: ID=507f... | Updated: 2025-05-13T10:30:00Z
   🗑️ DELETING: ID=507f... | Updated: 2025-05-12T10:30:00Z
   ✅ Deleted 2 duplicate(s)
```

After deduplication, verify with:

```bash
npx tsx checkStatus.ts
```

Your numbers should now match the expected totals (349 MPs, 47 Governors, 396 total).

## Clear Database for Fresh Start

To delete all scraped data and start scraping from scratch:

### Preview what will be deleted:
```bash
npm run db:clear:check
```

This shows:
- Total records to be deleted
- Breakdown by role (MPs, Governors, etc.)
- Confirmation before deletion

### Delete all data:
```bash
npm run db:clear
```

This will:
- Delete ALL member records from MongoDB
- Show before/after database state
- Confirm successful deletion

### Verify the database is empty:
```bash
npm run checkStatus
```

Should show:
- Total members: 0
- MPs: 0
- Governors: 0

Then you can restart the scraper for a fresh data collection:

```bash
npm run dev
# or trigger scraping via API
curl http://localhost:3000/api/scrape/trigger
```

> ⚠️ **Warning**: Deletion is permanent. Back up your data first if needed:
> ```bash
> npx tsx exportData.ts
> ```

## Error Screenshots

Error screenshots are automatically captured when the scraper encounters exceptions. They're saved to `screenshots/errors/` with metadata for easy debugging.

### Quick Commands

```bash
# View error statistics
npm run screenshot:analyze

# Generate HTML report of all errors
npm run screenshot:report

# List recent error screenshots
npm run screenshot:list

# Clean up old screenshots (older than 30 days)
npm run screenshot:clean
```

### View Error Report

After generating, open the report in your browser:

```bash
# Windows
start screenshots/errors/error_report.html

# Mac
open screenshots/errors/error_report.html

# Linux
xdg-open screenshots/errors/error_report.html
```

The report includes:
- Screenshots of what failed
- Error messages and timestamps
- Statistics by job type and date
- Full-page state when error occurred

See [ERROR_SCREENSHOTS.md](ERROR_SCREENSHOTS.md) for detailed documentation.

## Important Environment Variables

- `MONGODB_URI` - MongoDB connection string (required)
- `REDIS_HOST` - Redis host (defaults to `127.0.0.1`)
- `REDIS_PORT` - Redis port (defaults to `6379`)

## API Endpoints

### Health check

```
GET /health
```

### Manual scraper triggers

- Trigger standard scrape:
  - `GET /api/scrape/trigger`
- Trigger PDF processing:
  - `GET /api/scrape/trigger-pdf`

### Members endpoints

- Get members list:
  - `GET /api/members`
  - Query params: `page`, `limit`, `role`, `county`, `party`, `search`, `sortBy`, `sortOrder`
- Get member by ID:
  - `GET /api/members/:id`
- Get members by party:
  - `GET /api/members/party/:party`
- Get members by county:
  - `GET /api/members/county/:county`

### Statistics

- `GET /api/stats`

## Data Validation & Cleaning

The scraper includes comprehensive validation to prevent corrupted or invalid data (headers, labels, empty values) from being stored in the database.

### How It Works

- Invalid data patterns are detected (e.g., "vacant", "role", "education background")
- Headers and form labels are filtered out
- Invalid fields are set to `null` instead of storing garbage data
- Required fields (name, role) trigger record rejection if invalid
- Full-page extracted arrays (education, experience) have invalid entries filtered

### Example

**Before validation:**
```json
{ "fullName": "vacant", "role": "education background", "bio": "from" }
```

**After validation:**
```json
{ "fullName": null, "role": null, "bio": null }
// Record rejected - missing required fields
```

### Invalid Data Patterns

These are marked as null/empty:
- Empty values: "N/A", "None", "Unknown", "Vacant", "Pending"
- Headers: "Name", "Role", "Party", "Constituency", "Email"
- Labels: "Biography", "Profile", "From", "To"
- Too short: Values less than minimum length for field type
- Wrong format: Invalid emails, dates, URLs

See [DATA_VALIDATION.md](DATA_VALIDATION.md) for complete rules and customization.

## Notes

- The app uses MongoDB to store member data and Redis for BullMQ queues.
- Ensure MongoDB is reachable before starting the server.
- If you need to change ports or container settings, adjust the `docker-compose.yml` and `.env` values accordingly.
- Data validation helps maintain clean, reliable member records. See DATA_VALIDATION.md for details.

## License

ISC
