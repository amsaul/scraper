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
docker-compose up -d
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

## Notes

- The app uses MongoDB to store member data and Redis for BullMQ queues.
- Ensure MongoDB is reachable before starting the server.
- If you need to change ports or container settings, adjust the `docker-compose.yml` and `.env` values accordingly.

## License

ISC
