# Duplicate Members Issue - Root Cause & Solutions

## Problem Summary

Your database shows **741 total members** when you expect **396** (349 MPs + 47 Governors). This is ~1.87x the expected count, indicating you're storing duplicates.

### Why This Happens

The issue is in how members are being saved to the database. Your upsert queries use insufficient filters:

#### ❌ **OLD CODE (Creates Duplicates)**

In `src/workers/mainWorker.ts` - DISCOVER_MPS job:
```typescript
// TOO GENERIC - Only uses name as filter
const savedMember = await Member.findOneAndUpdate(
  { fullName: mp.name },  // <-- Problem!
  { ... },
  { upsert: true }
);
```

**Why this creates duplicates:**
- If the scraper runs twice, it still tries to create new records
- Name variations (e.g., "John Doe" vs "Hon. John Doe") create separate records
- No unique constraint on name alone → multiple records with same name

#### ✅ **NEW CODE (Prevents Duplicates)**

```typescript
// BETTER - Uses composite key
const savedMember = await Member.findOneAndUpdate(
  { 
    fullName: mp.name,
    role: 'MP',
    constituency: mp.constituency  // <-- More specific!
  },
  { ... },
  { upsert: true }
);
```

**Why this works:**
- Combination of (name + role + constituency) should be unique
- Won't create new record if that combination already exists
- Prevents duplicates even on multiple runs

---

## What's Been Fixed

### 1. **Updated Upsert Queries**
- **DISCOVER_MPS**: Added `constituency` to filter
- **PARSE_MEMBER_DETAIL**: Added `constituency` to filter  
- **PROCESS_MP_LIST_PDF**: Added `constituency` to filter
- **Governors**: Already correct (uses `role` + `county`)

### 2. **New Cleanup Scripts**

#### `analyzeDuplicates.ts`
Analyzes the current state of duplicates without making changes:

```bash
npx tsx analyzeDuplicates.ts
```

Shows:
- Total records vs unique members
- Which MPs/Governors have duplicates
- Top 10 most duplicated names

#### `deduplicateDB.ts`
Removes duplicate records from the database:

```bash
npx tsx deduplicateDB.ts
```

Process:
1. Groups members by (name, role, county)
2. For each group with duplicates:
   - Keeps the most recently updated record
   - Deletes all others
3. Shows detailed deletion log
4. Reports final counts

---

## Step-by-Step Solution

### Step 1: Analyze Current State
```bash
npx tsx analyzeDuplicates.ts
```
This shows you exactly what duplicates exist and their scale.

### Step 2: Remove Duplicates
```bash
npx tsx deduplicateDB.ts
```
This removes redundant records, keeping only the most recent version of each member.

### Step 3: Verify Results
```bash
npx tsx checkStatus.ts
```
Check the database status. Should now show:
- Total members: ~396
- MPs: ~349
- Governors: 47
- Active jobs: 0
- Waiting jobs: 0

### Step 4: Clean Restart (Optional)
If you want to completely fresh scrape:
```bash
# Delete all existing members
npx tsx -e "import Member from './src/models/members'; import { connectDB } from './src/config/db'; connectDB().then(() => Member.deleteMany({})).then(r => console.log('Deleted', r.deletedCount, 'members')).catch(e => console.error(e)).then(() => process.exit())"

# Restart scraping
curl http://localhost:3000/api/scrape/trigger
```

---

## Prevention Going Forward

With the fixed upsert queries:

✅ Running scrapers multiple times won't create duplicates
✅ Name variations are handled better
✅ Data re-scrapes will update existing records instead of creating new ones
✅ Each member is uniquely identified by: **name + role + constituency**

---

## Timeline

1. Current state: 741 members (duplicates)
2. After `analyzeDuplicates.ts`: Know exact scope
3. After `deduplicateDB.ts`: ~396 unique members
4. Going forward: Fixed upsert queries prevent new duplicates

---

## Additional Notes

### Why Governors Weren't Affected
Your governor upsert query was better:
```typescript
{ role: 'Governor', county: governor.county }
```
This is specific enough since each county has only one governor.

### What Could Still Cause Issues
- **Name normalization**: "John Smith" vs "JOHN SMITH" vs "John  Smith" might be seen as different
- **Data source variations**: Different sources providing slightly different names
- **Manual data entry**: Typos creating variations

### Future Improvements
Consider adding to Member schema:
```typescript
// Make combination unique
MemberSchema.index({ fullName: 1, role: 1, constituency: 1 }, { unique: true });
```

This would prevent duplicates at the database level, even if the application logic has issues.
