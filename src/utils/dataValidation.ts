/**
 * Data Validation Utilities
 * Checks and filters out invalid data captured from HTML
 */

/**
 * List of common invalid values that indicate missing/header data
 */
const INVALID_VALUES = new Set([
  // Empty/null indicators
  'n/a', 'na', 'none', 'unknown', 'vacant', 'pending',
  'not available', 'not provided', 'not specified',
  '',
  
  // Common HTML headers and labels (case-insensitive will be handled)
  'name', 'fullname', 'full name',
  'role', 'position', 'title',
  'party', 'political party',
  'constituency', 'county', 'region', 'ward',
  'email', 'phone', 'contact',
  'bio', 'biography', 'profile', 'about',
  'education', 'qualification',
  'experience', 'employment', 'employer',
  'committee', 'committees',
  'from', 'to', 'start', 'end', 'date',
  'organization', 'institution',
  'description', 'details',
  'website', 'url', 'link',
  'image', 'photo', 'picture',
  'status', 'active',
  'gender', 'date of birth',
  'profession', 'affiliation',
  'honours', 'awards',
  'caption', 'label', 'field',
  
  // Table headers
  'table', 'row', 'column', 'cell',
  's.no', 'no.', '#',
  
  // More specific patterns
  'hon.', 'hon', 'h.e.', 'dr.', 'dr', 'prof.', 'prof',
  'edit', 'delete', 'view', 'print', 'download',
  'actions', 'buttons', 'controls',
  
  // Common placeholder text
  'click here', 'select...', 'choose...', 'please select',
  'lorem ipsum', 'placeholder', 'example',
  'undefined', 'null', '(blank)', '[blank]', '[empty]'
]);

/**
 * Check if a value is valid data or invalid (header/label/empty)
 * @param value - The value to check
 * @returns true if valid, false if invalid/empty
 */
export function isValidData(value: any): boolean {
  // Check for null, undefined, empty
  if (value === null || value === undefined || value === '') {
    return false;
  }

  // Convert to string and trim
  const strValue = String(value).trim();

  // Check if empty after trim
  if (strValue === '') {
    return false;
  }

  // Check against invalid values (case-insensitive)
  if (INVALID_VALUES.has(strValue.toLowerCase())) {
    return false;
  }

  // Check if it looks like a table header pattern (too short, all caps, contains only special chars)
  if (strValue.length < 2) {
    return false;
  }

  // Check if it looks like placeholder text
  if (/^[\s\-|•\.]+$/.test(strValue)) {
    return false;
  }

  return true;
}

/**
 * Sanitize a string value - remove extra whitespace and validate
 * @param value - The value to sanitize
 * @returns Sanitized string or null if invalid
 */
export function sanitizeString(value: any): string | null {
  if (!isValidData(value)) {
    return null;
  }

  let strValue = String(value).trim();

  // Remove common prefix titles
  strValue = strValue.replace(/^(Hon\.|Hon |H\.E\.|H\.E |Dr\.|Dr |Prof\.|Prof )/i, '').trim();

  // Remove extra whitespace
  strValue = strValue.replace(/\s+/g, ' ');

  return isValidData(strValue) ? strValue : null;
}

/**
 * Sanitize array of strings - filter out invalid values
 * @param values - Array of values to sanitize
 * @returns Array of valid sanitized strings
 */
export function sanitizeStringArray(values: any[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map(v => sanitizeString(v))
    .filter((v) => v !== null) as string[];
}

/**
 * Validate member name
 * @param name - Name to validate
 * @returns Sanitized name or null if invalid
 */
export function validateName(name: any): string | null {
  const sanitized = sanitizeString(name);

  if (!sanitized) {
    return null;
  }

  // Name should have at least 3 characters
  if (sanitized.length < 3) {
    return null;
  }

  // Name should contain mostly letters
  const letterCount = (sanitized.match(/[a-zA-Z]/g) || []).length;
  if (letterCount < sanitized.length * 0.5) {
    return null;
  }

  return sanitized;
}

/**
 * Validate email
 * @param email - Email to validate
 * @returns Sanitized email or null if invalid
 */
export function validateEmail(email: any): string | null {
  const sanitized = sanitizeString(email);

  if (!sanitized) {
    return null;
  }

  // Basic email pattern
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(sanitized)) {
    return null;
  }

  return sanitized;
}

/**
 * Validate phone number
 * @param phone - Phone number to validate
 * @returns Sanitized phone or null if invalid
 */
export function validatePhone(phone: any): string | null {
  const sanitized = sanitizeString(phone);

  if (!sanitized) {
    return null;
  }

  // Phone should have at least 7 digits
  const digits = sanitized.replace(/\D/g, '');
  if (digits.length < 7) {
    return null;
  }

  return sanitized;
}

/**
 * Validate role/position
 * @param role - Role to validate
 * @returns Sanitized role or null if invalid
 */
export function validateRole(role: any): string | null {
  const sanitized = sanitizeString(role);

  if (!sanitized) {
    return null;
  }

  // Role should be one of the valid roles
  const validRoles = [
    'President', 'Deputy President',
    'Governor', 'Deputy Governor',
    'Senator', 'MP', 'Women Representative',
    'MCA',
    'Nominated Senator', 'Nominated MP', 'Nominated MCA',
    'Cabinet Secretary', 'Principal Secretary', 'Attorney General',
    'Speaker', 'Deputy Speaker', 'Majority Leader', 'Minority Leader',
    'Chief Whip', 'Deputy Whip'
  ];

  // Check if it matches any valid role (case-insensitive)
  if (validRoles.some(r => r.toLowerCase() === sanitized.toLowerCase())) {
    return validRoles.find(r => r.toLowerCase() === sanitized.toLowerCase()) || sanitized;
  }

  // If not a valid predefined role, still accept it if it looks like a real role
  if (sanitized.length >= 3 && /^[a-zA-Z\s]+$/.test(sanitized)) {
    return sanitized;
  }

  return null;
}

/**
 * Validate party name
 * @param party - Party to validate
 * @returns Sanitized party or null if invalid
 */
export function validateParty(party: any): string | null {
  const sanitized = sanitizeString(party);

  if (!sanitized) {
    return null;
  }

  // Party name should have letters and be reasonable length
  if (sanitized.length < 2 || sanitized.length > 100) {
    return null;
  }

  return sanitized;
}

/**
 * Validate county/constituency
 * @param location - County or constituency to validate
 * @returns Sanitized location or null if invalid
 */
export function validateLocation(location: any): string | null {
  const sanitized = sanitizeString(location);

  if (!sanitized) {
    return null;
  }

  // Location should be reasonable length
  if (sanitized.length < 2 || sanitized.length > 100) {
    return null;
  }

  return sanitized;
}

/**
 * Validate URL
 * @param url - URL to validate
 * @returns Sanitized URL or null if invalid
 */
export function validateUrl(url: any): string | null {
  const sanitized = sanitizeString(url);

  if (!sanitized) {
    return null;
  }

  try {
    new URL(sanitized);
    return sanitized;
  } catch (e) {
    return null;
  }
}

/**
 * Validate biography/text field
 * @param text - Text to validate
 * @returns Sanitized text or null if invalid
 */
export function validateText(text: any): string | null {
  const sanitized = sanitizeString(text);

  if (!sanitized) {
    return null;
  }

  // Bio should be at least 10 characters (meaningful text)
  if (sanitized.length < 10) {
    return null;
  }

  return sanitized;
}

/**
 * Validate date
 * @param date - Date to validate
 * @returns Date or null if invalid
 */
export function validateDate(date: any): Date | null {
  if (!date) {
    return null;
  }

  try {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return null;
    }

    // Check if date is reasonable (not too far in past or future)
    const now = new Date();
    const hundredYearsAgo = new Date(now.getFullYear() - 100, 0, 1);
    const fiftyYearsInFuture = new Date(now.getFullYear() + 50, 11, 31);

    if (dateObj < hundredYearsAgo || dateObj > fiftyYearsInFuture) {
      return null;
    }

    return dateObj;
  } catch (e) {
    return null;
  }
}

/**
 * Validate a complete member object and filter out invalid fields
 */
export function validateMemberData(data: any): any {
  return {
    fullName: validateName(data.fullName) || undefined,
    role: validateRole(data.role) || undefined,
    party: validateParty(data.party) || undefined,
    county: validateLocation(data.county) || undefined,
    constituency: validateLocation(data.constituency) || undefined,
    ward: validateLocation(data.ward) || undefined,
    email: validateEmail(data.email) || undefined,
    phone: validatePhone(data.phone) || undefined,
    website: validateUrl(data.website) || undefined,
    bio: validateText(data.bio) || undefined,
    dateOfBirth: validateDate(data.dateOfBirth) || undefined,
    profileImage: validateUrl(data.profileImage) || undefined,
    education: Array.isArray(data.education) ? data.education.map((e: any) => ({
      from: e.from,
      to: e.to,
      institution: validateString(e.institution),
      qualification: validateString(e.qualification)
    })).filter((e: any) => e.institution || e.qualification) : undefined,
    experience: Array.isArray(data.experience) ? data.experience.map((e: any) => ({
      from: e.from,
      to: e.to,
      organization: validateString(e.organization),
      title: validateString(e.title)
    })).filter((e: any) => e.organization || e.title) : undefined,
    committees: Array.isArray(data.committees) ? data.committees.map((c: any) => ({
      from: c.from,
      to: c.to,
      name: validateString(c.name),
      role: validateString(c.role)
    })).filter((c: any) => c.name) : undefined,
    professionalAffiliations: sanitizeStringArray(data.professionalAffiliations) || undefined,
    honours: sanitizeStringArray(data.honours) || undefined,
    sourceUrls: Array.isArray(data.sourceUrls) ? data.sourceUrls.map(validateUrl).filter((u) => u !== null) : undefined
  };
}

/**
 * Helper to validate generic string field
 */
function validateString(value: any): string | null {
  return sanitizeString(value);
}

/**
 * Log validation results for debugging
 */
export function logValidationResult(fieldName: string, originalValue: any, validatedValue: any): void {
  if (originalValue !== validatedValue) {
    console.log(`   ⚠️ ${fieldName}: "${originalValue}" → ${validatedValue === null ? 'null' : `"${validatedValue}"`}`);
  }
}
