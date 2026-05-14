# Data Validation & Cleaning

## Overview

The scraper now includes comprehensive data validation to prevent invalid or corrupted data from being stored in the database. When scraping captures headers, labels, or empty values instead of real data, these are now identified and set to `null`.

## What Gets Validated

### Invalid Data Patterns

Data is marked as invalid (null) if it matches:

- **Empty/null indicators**: "N/A", "None", "Unknown", "Vacant", "Pending"
- **HTML headers**: "Name", "Role", "Party", "Constituency", "Email", "Phone"
- **Form labels**: "Biography", "Profile", "From", "To", "Edit", "Delete"
- **Placeholder text**: "Lorem ipsum", "Click here", "Select..."
- **Prefixes**: "Hon.", "H.E.", "Dr.", "Prof." (automatically removed)

### Validated Fields

For each member, these fields are validated:

| Field | Rules | Invalid Examples |
|-------|-------|------------------|
| **fullName** | 3+ chars, mostly letters | "vacant", "name", "unknown" |
| **role** | Must be valid role or reasonable text | "education background", "edit" |
| **party** | 2-100 chars | "parties and coalitions", "none" |
| **constituency/county** | 2-100 chars | "N/A", "county" |
| **email** | Valid email format | "email", "not@available" |
| **phone** | 7+ digits | "phone", "123" |
| **bio** | 10+ chars of meaningful text | "from", "N/A" |
| **dateOfBirth** | Valid date, within 100 years | "date", "1800-01-01" |
| **website/URL** | Valid URL format | "website", "url" |

### Arrays (Education, Experience, Committees)

Invalid entries in arrays are automatically filtered out:
- Empty institution names
- Missing job titles in experience
- Committees without names

## How It Works

### During Discovery (DISCOVER_MPS, DISCOVER_GOVERNORS)

1. MP/Governor data is extracted from the web
2. Name and constituency/county are validated
3. Invalid data is **skipped entirely** (not saved)
4. Valid data is queued for detailed parsing

### During Detail Parsing (PARSE_MEMBER_DETAIL)

1. All member details are extracted
2. Each field is validated against rules
3. Invalid values are set to `null` (not stored)
4. If required fields (name, role) are invalid, record is rejected
5. Valid data is saved to database

### During PDF Processing (PROCESS_MP_LIST_PDF)

1. MPs extracted from PDF are validated
2. Invalid entries are skipped
3. Valid MPs are saved with checked data

## Benefits

✅ **No garbage data** - "education background" won't be stored as a role
✅ **Cleaner database** - Invalid fields are null, not wrong strings
✅ **Easier debugging** - Know exactly what was validated vs rejected
✅ **Better searches** - Can filter by `role: null` for missing data
✅ **Improved data quality** - No more mixing of headers and data

## Example

### Before Validation (❌ Problem)
```json
{
  "fullName": "vacant",
  "role": "education background",
  "constituency": "parties and coalitions",
  "bio": "from",
  "email": "email"
}
```

### After Validation (✅ Clean)
```json
{
  "fullName": null,        // "vacant" is invalid
  "role": null,            // "education background" is not a valid role
  "constituency": null,    // "parties and coalitions" is not a location
  "bio": null,             // "from" is too short/invalid
  "email": null            // "email" is not a valid email format
}
```

The entire record would be rejected because fullName and role are required.

## Logging

When data is validated, the logs show what changed:

```
🔍 Validating extracted data for John Smith...
   ⚠️ email: "email@" → null
   ⚠️ bio: "some text" → null (too short)
✅ Saved to DB: John Smith
```

Or if validation fails:

```
❌ Validation failed - Missing required fields:
   - Full Name: vacant
   - Role: education background
```

## Data Quality Checks

Run these commands to verify data quality:

```bash
# Check current database status
npm run checkStatus

# Analyze duplicates
npm run analyzeDuplicates

# Export data to review
npx tsx exportData.ts
```

Then review the `members_export.json` to see if any `null` fields need investigation.

## Validation Rules (Code Reference)

All validation logic is in `src/utils/dataValidation.ts`:

### Main validation functions:
- `isValidData(value)` - Basic validation
- `sanitizeString(value)` - Clean and validate strings
- `validateName(value)` - Full name validation
- `validateRole(value)` - Role/position validation
- `validateParty(value)` - Political party validation
- `validateLocation(value)` - County/constituency validation
- `validateEmail(value)` - Email format validation
- `validatePhone(value)` - Phone number validation
- `validateText(value)` - Biography/text field validation
- `validateDate(value)` - Date range validation
- `validateUrl(value)` - URL format validation

## Customizing Validation

To add or modify validation rules, edit `src/utils/dataValidation.ts`:

```typescript
// Add to INVALID_VALUES set for new patterns
const INVALID_VALUES = new Set([
  // ... existing values ...
  'my_new_invalid_pattern',
]);

// Add custom validation function for specific fields
export function validateMyField(value: any): string | null {
  // Your logic here
  return validValue;
}
```

Then import and use in `mainWorker.ts`:

```typescript
import { validateMyField } from '../utils/dataValidation';

const validated = validateMyField(data.field);
```

## Migration for Existing Data

If you already have corrupted data in your database from before validation was added:

1. **Backup your data first**:
   ```bash
   npx tsx exportData.ts
   ```

2. **Clear and re-scrape**:
   ```bash
   npm run db:clear
   npm run dev
   ```

The new data will be clean and validated from the start.

Or, if you want to keep some existing data, you can manually edit `members_export.json` and re-import it.

## Troubleshooting

### Many records showing "Invalid data" warnings

This usually means the HTML structure of the government portal changed. Check:
1. Run a manual scrape and review the screenshots: `npm run screenshot:report`
2. Check the page HTML to see what changed
3. Update the extraction selectors in `mainWorker.ts`

### Specific field showing as null when it should have data

1. Check the extraction logic in `mainWorker.ts` - might be extracting wrong element
2. Review error screenshots for that URL
3. Consider if the validation rule is too strict
4. Check `src/utils/dataValidation.ts` INVALID_VALUES list

### Validation rejecting valid data

The validation might be too strict. You can:
1. Temporarily disable validation for debugging
2. Adjust minimum length requirements
3. Add exceptions for specific patterns

---

**Result**: Clean, validated data that's reliable for analysis and reporting!
