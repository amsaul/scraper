import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { scraperEngine } from '../services/scraper';
import Member from '../models/members';
import { connectDB } from '../config/db';
import { pdfService } from '../services/pdfServices';
import { screenshotService } from '../services/screenshotService';
import { scrapeQueue, pushQueue } from '../services/queue';
import {
  validateMemberData,
  validateName,
  validateRole,
  validateParty,
  validateLocation,
  validateUrl,
  validateEmail,
  validatePhone,
  validateText,
  sanitizeString,
} from '../utils/dataValidation';
import { parseName } from '../utils/nameParser';
import { inferGender } from '../utils/genderInference';
import { parseDOB } from '../utils/dateParser';
import { downloadAndRehostImage } from '../services/imageService';
import { resolveCounty } from '../utils/constituencyCountyMap';

// Ensure database is connected
connectDB();

type GovernorData = {
  fullName: string;
  county: string;
  role: string;
  honorifics: string[];
  sourceUrls: string[];
  termStart: number;
  termEnd: number;
  dateAssumedOffice: Date;
  lastUpdated: Date;
};

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'verivote-scrape-queue',
  async (job: Job) => {
    console.log('\n' + '='.repeat(50));
    console.log(`🚀 STARTING JOB: ${job.id}`);
    console.log(`📌 Job Name: ${job.name}`);
    console.log(`📦 Job Data:`, JSON.stringify(job.data, null, 2));
    console.log('='.repeat(50));

    let page = null;

    try {
      // Initialize browser
      page = await scraperEngine.createManagedPage();

      if (job.name === 'DISCOVER_MPS') {
        console.log('🔍 Starting MP discovery...');

        const baseUrl = 'https://www.parliament.go.ke/the-national-assembly/mps';
        let currentPage = 1;
        let hasMorePages = true;
        let totalMPsExtracted = 0;

        interface TableMP {
          name: string;
          constituency: string;
          party: string;
          profileUrl: string | null;
        }

        while (hasMorePages) {
          const url = currentPage === 1 ? baseUrl : `${baseUrl}?page=${currentPage - 1}`;
          console.log(`\n📄 ===== PAGE ${currentPage} =====`);
          console.log(`🌐 Navigating to: ${url}`);

          await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
          await scraperEngine.waitRandom(3000, 5000);

          const pageMembers: TableMP[] = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tbody tr');
            const members: TableMP[] = [];

            const headerRow = document.querySelector('table thead tr');
            let nameIndex = 0;
            let constituencyIndex = 1;
            let partyIndex = 2;

            if (headerRow) {
              const headers = headerRow.querySelectorAll('th');
              headers.forEach((header, index) => {
                const text = header.textContent?.toLowerCase() || '';
                if (text.includes('name')) nameIndex = index;
                if (text.includes('constituency') || text.includes('area')) constituencyIndex = index;
                if (text.includes('party')) partyIndex = index;
              });
            }

            rows.forEach(row => {
              const cells = row.querySelectorAll('td');
              const maxIndex = Math.max(nameIndex, constituencyIndex, partyIndex);
              if (cells.length <= maxIndex) return;

              const link = Array.from(row.querySelectorAll('a')).find(anchor => {
                const href = anchor.getAttribute('href') || '';
                return (
                  href.includes('/the-national-assembly/hon-') ||
                  href.includes('/the-national-assembly/women-representative') ||
                  href.includes('/the-national-assembly/member/') ||
                  href.includes('/the-national-assembly/amb-')
                );
              });
              const profileUrl = link
                ? new URL(link.getAttribute('href') || '', window.location.origin).href
                : null;

              let name = cells[nameIndex]?.textContent?.trim() || '';
              if (!name) {
                const nameAnchor = row.querySelector('a[hreflang="en"]');
                name = nameAnchor?.textContent?.trim() || '';
              }
              if (!name) {
                name = row.querySelector('img[alt]')?.getAttribute('alt')?.trim() || '';
              }
              name = name.replace(/^Hon\.\s*/i, '').trim();

              let constituency = cells[constituencyIndex]?.textContent?.trim() || '';
              let party = cells[partyIndex]?.textContent?.trim() || '';

              const counties = [
                'NAIROBI', 'MOMBASA', 'KISUMU', 'NAKURU', 'KIAMBU', 'MACHAKOS',
                'MURANGA', 'KITUI', 'MAKUENI', 'TURKANA', 'WEST POKOT', 'SAMBURU',
                'TRANS NZOIA', 'UASIN GISHU', 'ELGEYO MARAKWET', 'NANDI', 'BARINGO',
                'LAIKIPIA', 'KERICHO', 'BOMET', 'KAKAMEGA', 'VIHIGA', 'BUNGOMA',
                'BUSIA', 'SIAYA', 'KISII', 'NYAMIRA', 'HOMA BAY', 'MIGORI',
                'NYERI', 'KIRINYAGA', "MURANG'A", 'KIAMBU', 'MARSABIT',
              ];
              if (party && counties.includes(party.toUpperCase()) && !counties.includes(constituency.toUpperCase())) {
                console.log(`🔄 Swapping party and constituency for ${name}: party=${party}, constituency=${constituency}`);
                const temp = party;
                party = constituency;
                constituency = temp;
              }

              if (name && !name.toLowerCase().includes('name')) {
                members.push({ name, constituency, party, profileUrl });
              }
            });
            return members;
          });

          console.log(`📊 Found ${pageMembers.length} MPs on page ${currentPage}`);
          console.log('─'.repeat(60));

          for (let i = 0; i < pageMembers.length; i++) {
            const mp = pageMembers[i];
            console.log(`\n👤 MP #${totalMPsExtracted + i + 1}:`);
            console.log(`   └─ Name: ${mp.name}`);
            console.log(`   └─ Constituency: ${mp.constituency}`);
            console.log(`   └─ Party: ${mp.party}`);
            console.log(`   └─ Profile URL: ${mp.profileUrl || 'N/A'}`);

            const validatedName = validateName(mp.name);
            const validatedConstituency = validateLocation(mp.constituency);
            const validatedParty = validateParty(mp.party);

            if (!validatedName || !validatedConstituency) {
              console.log(`   ⚠️ Skipping - Invalid data (name or constituency missing)`);
              continue;
            }

            const savedMember = await Member.findOneAndUpdate(
              {
                fullName: validatedName,
                role: 'MP',
                constituency: validatedConstituency,
              },
              {
                fullName: validatedName,
                party: validatedParty,
                county: validatedConstituency,
                constituency: validatedConstituency,
                role: 'MP',
                sourceUrls: mp.profileUrl ? [mp.profileUrl] : [url],
              },
              { upsert: true, returnDocument: 'after' }
            );

            console.log(`   └─ Status: ✅ Saved (ID: ${savedMember._id})`);

            if (mp.profileUrl) {
              await scrapeQueue.add('PARSE_MEMBER_DETAIL', {
                url: mp.profileUrl,
                role: 'MP',
                discoveredAt: new Date().toISOString(),
              });
              console.log(`   └─ Queue: 📤 Added for detail parsing`);
            }
            totalMPsExtracted++;
          }

          console.log('\n' + '─'.repeat(60));

          hasMorePages = await page.evaluate(() => {
            const nextLink = document.querySelector('a[rel="next"]');
            const lastPageLink = document.querySelector('li.pager__item--last a');
            return !!(nextLink || lastPageLink);
          });
          if (hasMorePages) currentPage++;
          else console.log(`✅ No more pages. Processed ${currentPage} pages total.`);
        }

        console.log('\n' + '='.repeat(60));
        console.log(`🎉 FINAL SUMMARY:`);
        console.log(`   ├─ Total MPs extracted: ${totalMPsExtracted}`);
        console.log(`   ├─ Total pages processed: ${currentPage}`);
        console.log('='.repeat(60));

        const mpLinks: string[] = await page.evaluate(() => {
          const links: string[] = [];
          const allLinks = document.querySelectorAll('a');
          allLinks.forEach(link => {
            const href = (link as HTMLAnchorElement).href;
            const text = link.textContent?.toLowerCase() || '';
            if (
              href.includes('/hon-') ||
              href.includes('/member/') ||
              href.includes('/mp/') ||
              (text.includes('hon.') && !href.includes('.pdf')) ||
              href.match(/\/the-national-assembly\/hon-[\w-]+/)
            ) {
              if (!links.includes(href) && !href.includes('.pdf')) links.push(href);
            }
          });
          return links;
        });
        console.log(`✅ Found ${mpLinks.length} additional profile links`);
      } else if (job.name === 'CHECK_HANSARD') {
        console.log('📄 Checking for new Hansard documents...');
        await page.goto('https://hansardna.parliament.go.ke/home', {
          waitUntil: 'networkidle2',
          timeout: 60000,
        });
        const hansardLinks = await page.evaluate(() => {
          const links: Array<{ url: string; date: string; title: string }> = [];
          document.querySelectorAll('a[href$=".pdf"]').forEach(link => {
            const href = (link as HTMLAnchorElement).href;
            const text = link.textContent || '';
            if (href.includes('hansard') || text.toLowerCase().includes('hansard')) {
              const dateMatch = text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/) || href.match(/\d{4}-\d{2}-\d{2}/);
              links.push({
                url: href,
                date: dateMatch ? dateMatch[0] : new Date().toISOString().split('T')[0],
                title: text || 'Hansard Document',
              });
            }
          });
          return links.slice(0, 10);
        });
        console.log(`📄 Found ${hansardLinks.length} Hansard documents`);
        for (const link of hansardLinks) {
          const existingMember = await Member.findOne({ 'hansardContributions.transcriptUrl': link.url });
          if (!existingMember) {
            await scrapeQueue.add('PROCESS_HANSARD', {
              url: link.url,
              date: link.date,
              topic: link.title,
              discoveredAt: new Date().toISOString(),
            });
            console.log(`📄 Added new Hansard to queue: ${link.title}`);
          }
        }
      } else if (job.name === 'RETRY_FAILED_PUSHES') {
        console.log('🔄 Retrying failed push jobs...');
        const failedMembers = await Member.find({
          pushStatus: 'failed',
          lastPushAttempt: { $lt: new Date(Date.now() - 60 * 60 * 1000) },
        }).limit(50);
        console.log(`🔄 Found ${failedMembers.length} failed members to retry`);
        for (const member of failedMembers) {
          try {
            await pushQueue.add('PUSH_TO_VERIVOTE', {
              member: member.toObject ? member.toObject() : member,
              action: 'retry',
              originalId: member._id,
            });
            console.log(`📤 Added retry job for: ${member.fullName}`);
          } catch (error) {
            console.error(`❌ Failed to add retry job for ${member.fullName}:`, error);
          }
        }
      } else if (job.name === 'REFRESH_MEMBERS') {
        console.log('🔄 Refreshing member data...');
        const members = await Member.find({ role: 'MP' }).limit(100);
        console.log(`🔄 Queueing refresh for ${members.length} members`);
        for (const member of members) {
          if (member.sourceUrls && member.sourceUrls.length > 0) {
            await scrapeQueue.add('PARSE_MEMBER_DETAIL', {
              url: member.sourceUrls[0],
              role: 'MP',
              refresh: true,
              memberId: member._id,
            });
          }
        }
      } else if (job.name === 'PARSE_MEMBER_DETAIL') {
        // ========== UPDATED BLOCK WITH NAME PARSING, GENDER, DOB, AVATAR REHOST ==========
        const { url, role } = job.data;
        console.log(`🔍 Parsing member detail from: ${url}`);

        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await scraperEngine.waitRandom(2000, 3000);

          // Helper to convert year strings to Date objects
          const convertToDate = (yearStr: string): Date | null => {
            if (!yearStr || yearStr.toLowerCase() === 'date' || yearStr.toLowerCase() === 'to' || yearStr.toLowerCase() === 'from') {
              return null;
            }
            const yearMatch = yearStr.match(/\d{4}/);
            if (yearMatch) return new Date(`${yearMatch[0]}-01-01`);
            return null;
          };

          // Extract all data inside evaluate (keeps existing extraction logic)
          const memberData = await page.evaluate(
            (passedUrl, passedRole) => {
              const titleText = document.querySelector('h1')?.textContent?.trim() || document.title.split('|')[0].trim();
              let fullName = titleText.replace(/^Hon\.?\s*/i, '').trim();
              if (!fullName) {
                fullName =
                  passedUrl
                    .split('/')
                    .pop()
                    ?.replace(/-/g, ' ')
                    .replace(/^hon\.?\s*/i, '')
                    .trim() || 'Unknown';
              }

              const pageText = document.body.innerText || '';

              // Party
              const partyMatch = pageText.match(/Party\s*[:\-]\s*([A-Za-z0-9\- ]+)/i);
              let party = 'Independent';
              if (partyMatch) {
                party = partyMatch[1].trim();
              } else {
                const knownParties = [
                  'UDA', 'ODM', 'ANC', 'Jubilee', 'WDM', 'UPA', 'KANU', 'FORD-K', 'CCM', 'DAP-K', 'JP',
                  'PAA', 'TSP', 'MDG', 'KUP', 'MCCP', 'NAP-K', 'NOPEU', 'GDDP',
                ];
                for (const p of knownParties) {
                  if (pageText.includes(p)) {
                    party = p;
                    break;
                  }
                }
              }

              // Constituency
              let constituency = 'N/A';
              const constituencyMatch = pageText.match(/Constituency\s*[:\-]\s*([A-Za-z0-9 '\/]+)/i);
              if (constituencyMatch) {
                constituency = constituencyMatch[1].trim();
              } else {
                const lines = pageText.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].toLowerCase().includes('constituency') && i + 1 < lines.length) {
                    constituency = lines[i + 1].trim();
                    break;
                  }
                }
              }

              // Bio
              const bio =
                document.querySelector('div.field--name-body p')?.textContent?.trim() ||
                document.querySelector('article p')?.textContent?.trim() ||
                document.querySelector('p')?.textContent?.trim() ||
                '';

              // Profile image
              const profileImage = (() => {
                const img = Array.from(document.querySelectorAll('img')).find(i => {
                  const src = i.getAttribute('src') || '';
                  return src.includes('/sites/default/files/styles/mp_photo') || src.includes('member_photo') || src.toLowerCase().includes('mp_');
                });
                return img ? new URL(img.getAttribute('src') || '', window.location.origin).href : '';
              })();

              // Email, phone, website
              const emailAnchor =
                Array.from(document.querySelectorAll('a[href^="mailto:"]'))
                  .map(a => (a as HTMLAnchorElement).href.replace(/^mailto:/i, '').trim())
                  .find(Boolean) || '';
              const phoneAnchor =
                Array.from(document.querySelectorAll('a[href^="tel:"]'))
                  .map(a => (a as HTMLAnchorElement).href.replace(/^tel:/i, '').trim())
                  .find(Boolean) || '';
              const websiteAnchor =
                Array.from(document.querySelectorAll('a[href^="http"]'))
                  .map(a => (a as HTMLAnchorElement).href)
                  .find(href => !href.includes('parliament.go.ke') && !href.includes('mailto:') && !href.includes('tel:')) || '';

              // Date of birth (as string, will be parsed later)
              let dateOfBirth: string | null = null;
              const dobMatch = pageText.match(/Born\s*[:\-]?\s*([A-Za-z0-9 ,]+)/i);
              if (dobMatch) dateOfBirth = dobMatch[1].trim();

              // Education
              const education: Array<{ from: string; to: string; institution: string; qualification: string }> = [];
              const academicTables = Array.from(document.querySelectorAll('table')).filter(table => {
                const firstRow = table.querySelector('tr');
                if (!firstRow) return false;
                const cells = Array.from(firstRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
                return cells.some(cell => /Institution/i.test(cell)) && cells.some(cell => /Qualification/i.test(cell));
              });
              academicTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                for (let i = 1; i < rows.length; i++) {
                  const cells = rows[i].querySelectorAll('td');
                  if (cells.length >= 4) {
                    const fromYear = cells[0]?.textContent?.trim() || '';
                    const toYear = cells[1]?.textContent?.trim() || '';
                    const institution = cells[2]?.textContent?.trim() || '';
                    const qualification = cells[3]?.textContent?.trim() || '';
                    if (
                      !institution ||
                      !qualification ||
                      /^(Institution|From|To|Qualification)$/i.test(institution) ||
                      /^(Institution|From|To|Qualification)$/i.test(qualification)
                    )
                      continue;
                    const item = { from: fromYear, to: toYear, institution, qualification };
                    const isDuplicate = education.some(
                      existing =>
                        existing.institution === item.institution &&
                        existing.qualification === item.qualification &&
                        existing.from === item.from,
                    );
                    if (!isDuplicate) education.push(item);
                  }
                }
              });

              // Experience
              const experience: Array<{ from: string; to: string; organization: string; title: string }> = [];
              const employmentTables = Array.from(document.querySelectorAll('table')).filter(table => {
                const firstRow = table.querySelector('tr');
                if (!firstRow) return false;
                const cells = Array.from(firstRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
                return (
                  (cells.some(cell => /Employer/i.test(cell)) || cells.some(cell => /Organization/i.test(cell))) &&
                  cells.some(cell => /Position|Title/i.test(cell))
                );
              });
              employmentTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                for (let i = 1; i < rows.length; i++) {
                  const cells = rows[i].querySelectorAll('td');
                  if (cells.length >= 4) {
                    const fromYear = cells[0]?.textContent?.trim() || '';
                    const toYear = cells[1]?.textContent?.trim() || '';
                    const organization = cells[2]?.textContent?.trim() || '';
                    const title = cells[3]?.textContent?.trim() || '';
                    if (
                      !organization ||
                      !title ||
                      /^(Organization|From|To|Position|Title|Employer)$/i.test(organization) ||
                      /^(Organization|From|To|Position|Title|Employer)$/i.test(title)
                    )
                      continue;
                    const item = { from: fromYear, to: toYear, organization, title };
                    const isDuplicate = experience.some(
                      existing =>
                        existing.organization === item.organization &&
                        existing.title === item.title &&
                        existing.from === item.from,
                    );
                    if (!isDuplicate) experience.push(item);
                  }
                }
              });

              // Committees
              const committees: Array<{ from: string; to: string; name: string; role: string }> = [];
              const committeeTables = Array.from(document.querySelectorAll('table')).filter(table => {
                const firstRow = table.querySelector('tr');
                if (!firstRow) return false;
                const cells = Array.from(firstRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
                return cells.some(cell => /Committee/i.test(cell)) && cells.some(cell => /Position|Role/i.test(cell));
              });
              committeeTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                for (let i = 1; i < rows.length; i++) {
                  const cells = rows[i].querySelectorAll('td');
                  if (cells.length >= 4) {
                    const fromYear = cells[0]?.textContent?.trim() || '';
                    const toYear = cells[1]?.textContent?.trim() || '';
                    const name = cells[2]?.textContent?.trim() || '';
                    const role = cells[3]?.textContent?.trim() || '';
                    if (!name || !role || /^(Committee|From|To|Position|Role)$/i.test(name) || /^(Committee|From|To|Position|Role)$/i.test(role))
                      continue;
                    const item = { from: fromYear, to: toYear, name, role };
                    const isDuplicate = committees.some(
                      existing => existing.name === item.name && existing.role === item.role && existing.from === item.from,
                    );
                    if (!isDuplicate) committees.push(item);
                  }
                }
              });

              // Professional affiliations
              const professionalAffiliations: string[] = [];
              const profAffMatch = pageText.match(/Professional Affiliation[s]?\s*[:\-]\s*(.+?)(?=\n\n|\n[A-Z]|$)/i);
              if (profAffMatch) {
                const affiliations = profAffMatch[1]
                  .trim()
                  .split(/[,;]/)
                  .map(aff => aff.trim())
                  .filter(aff => aff.length > 0);
                professionalAffiliations.push(...affiliations);
              }

              // Honours
              const honours: string[] = [];
              const nameHonours = fullName.match(/(CBS|EGH|CBE|OBE|MBS|MBE|MPH|PhD|Dr\.?)/g) || [];
              honours.push(...nameHonours);
              const honourMatches = pageText.match(/Honours?\/?Awards?\s*[:\-]\s*(.+?)(?=\n\n|\n[A-Z]|$)/i);
              if (honourMatches) {
                const extractedHonours = honourMatches[1]
                  .trim()
                  .split(/[,;]/)
                  .map(h => h.trim())
                  .filter(h => h.length > 0);
                honours.push(...extractedHonours);
              }
              const awardMatches = pageText.match(/Awards?\s*[:\-]\s*(.+?)(?=\n\n|\n[A-Z]|$)/i);
              if (awardMatches) {
                const extractedAwards = awardMatches[1]
                  .trim()
                  .split(/[,;]/)
                  .map(a => a.trim())
                  .filter(a => a.length > 0);
                honours.push(...extractedAwards);
              }
              const uniqueHonours = [...new Set(honours.map(h => h.toUpperCase()))].map(
                h => honours.find(orig => orig.toUpperCase() === h) || h,
              );

              return {
                fullName,
                party,
                constituency,
                county: constituency,
                role: passedRole,
                sourceUrls: [passedUrl],
                bio,
                email: emailAnchor,
                phone: phoneAnchor,
                website: websiteAnchor,
                profileImage,
                dateOfBirth,
                education,
                experience,
                committees,
                professionalAffiliations,
                honours: uniqueHonours,
              };
            },
            url,
            role,
          );

          // ----- NEW: Extract pageText again for honorifics & fallback DOB parsing -----
          const pageText = await page.evaluate(() => document.body.innerText);

          // ----- 1. Name parsing -----
          const parsedName = parseName(memberData.fullName);
          console.log(`   ✨ Name parsed: first="${parsedName.firstName}", middle="${parsedName.middleName}", last="${parsedName.lastName}"`);

          // ----- 2. Gender inference -----
          // Extract honorifics from pageText
          const honorifics: string[] = [];
          const honorificRegex = /\b(Mrs?|Ms|Miss|Dr|Prof|Hon|Amb|Eng)\.?/gi;
          let match;
          while ((match = honorificRegex.exec(pageText)) !== null) {
            honorifics.push(match[1]);
          }
          const gender = inferGender(parsedName.firstName, honorifics);
          if (gender) console.log(`   🚻 Gender inferred: ${gender}`);
          else console.log(`   ❓ Gender could not be inferred`);

          // ----- 3. Date of birth parsing (async with Wikipedia fallback) -----
          let parsedDOB: Date | null = null;
          if (memberData.dateOfBirth) {
            parsedDOB = await parseDOB(memberData.dateOfBirth, memberData.fullName);
            if (parsedDOB) console.log(`   🎂 Date of birth parsed: ${parsedDOB.toISOString().split('T')[0]}`);
            else console.log(`   ⚠️ Could not parse DOB from "${memberData.dateOfBirth}"`);
          } else {
            // Try to find DOB in pageText using parseDOB anyway
            parsedDOB = await parseDOB(pageText, memberData.fullName);
            if (parsedDOB) console.log(`   🎂 Date of birth found in pageText: ${parsedDOB.toISOString().split('T')[0]}`);
          }

          // ----- 4. Phone normalisation is already handled by validatePhone (which we call later) -----
          // The validatePhone function in dataValidation.ts should now return E.164 format.

          // ----- 5. Avatar rehosting -----
          let rehostedImageUrl: string | null = null;
          if (memberData.profileImage && memberData.profileImage.startsWith('http')) {
            console.log(`   📸 Downloading & rehosting image from ${memberData.profileImage}`);
            rehostedImageUrl = await downloadAndRehostImage(memberData.profileImage);
            if (rehostedImageUrl) {
              console.log(`   ✅ Image rehosted to: ${rehostedImageUrl}`);
              memberData.profileImage = rehostedImageUrl;
            } else {
              console.log(`   ⚠️ Image rehosting failed, keeping original URL`);
            }
          }

          // ----- Convert education/experience/committees dates -----
          const convertedEducation =
            memberData.education?.map(edu => ({
              from: convertToDate(edu.from),
              to: convertToDate(edu.to),
              institution: edu.institution,
              qualification: edu.qualification,
            })) || [];

          const convertedExperience =
            memberData.experience?.map(exp => ({
              from: convertToDate(exp.from),
              to: convertToDate(exp.to),
              organization: exp.organization,
              title: exp.title,
            })) || [];

          const convertedCommittees =
            memberData.committees?.map(com => ({
              from: convertToDate(com.from),
              to: convertToDate(com.to),
              name: com.name,
              role: com.role,
            })) || [];

          // ----- Validate data -----
          console.log(`\n🔍 Validating extracted data for ${memberData.fullName}...`);
          const validatedFullName = validateName(memberData.fullName);
          const validatedRole = validateRole(memberData.role);
          const validatedParty = validateParty(memberData.party);
          const validatedCounty = validateLocation(memberData.county);
          const validatedConstituency = validateLocation(memberData.constituency);
          const validatedWebsite = validateUrl(memberData.website);
          const validatedProfileImage = validateUrl(memberData.profileImage);
          const validatedSourceUrls = Array.isArray(memberData.sourceUrls)
            ? memberData.sourceUrls.map(validateUrl).filter((u): u is string => u !== null)
            : [];
          const validatedEmail = validateEmail(memberData.email);
          const validatedPhone = validatePhone(memberData.phone);
          const validatedBio = validateText(memberData.bio);

          if (!validatedFullName || !validatedRole) {
            console.log(`❌ Validation failed - Missing required fields:`);
            if (!validatedFullName) console.log(`   - Full Name: ${memberData.fullName}`);
            if (!validatedRole) console.log(`   - Role: ${memberData.role}`);
            throw new Error('Invalid member data - missing required fields');
          }

          // ----- Prepare update object with new fields -----
          const inferredCounty = validatedCounty || (validatedConstituency ? resolveCounty(validatedConstituency) : null);

          const updateFields: any = {
            fullName: validatedFullName,
            firstName: parsedName.firstName,
            middleName: parsedName.middleName,
            lastName: parsedName.lastName,
            gender: gender,
            party: validatedParty,
            county: inferredCounty,
            constituency: validatedConstituency,
            role: validatedRole,
            sourceUrls: validatedSourceUrls.length ? validatedSourceUrls : undefined,
            bio: validatedBio,
            email: validatedEmail || undefined,
            phone: validatedPhone || undefined,
            website: validatedWebsite || undefined,
            profileImage: validatedProfileImage || undefined,
            dateOfBirth: parsedDOB || undefined,
            education: convertedEducation,
            experience: convertedExperience,
            committees: convertedCommittees,
            professionalAffiliations: memberData.professionalAffiliations,
            honours: memberData.honours,
          };

          // Remove undefined fields to avoid overwriting with null
          Object.keys(updateFields).forEach(key => updateFields[key] === undefined && delete updateFields[key]);

          // ----- Save to database -----
          const savedMember = await Member.findOneAndUpdate(
            {
              fullName: validatedFullName,
              role: validatedRole,
              constituency: validatedConstituency,
            },
            updateFields,
            { upsert: true, returnDocument: 'after' },
          );

          if (savedMember) {
            console.log(`✅ Saved to DB: ${memberData.fullName}`);
            // Push to Verivote queue
            try {
              await pushQueue.add('PUSH_TO_VERIVOTE', {
                member: savedMember.toObject ? savedMember.toObject() : savedMember,
                action: 'update',
              });
              console.log(`📤 Added to push queue: ${memberData.fullName}`);
            } catch (pushError) {
              console.error('❌ Failed to add to push queue:', pushError);
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ Error in PARSE_MEMBER_DETAIL:`, errorMsg);
          await screenshotService.captureErrorScreenshot(page, errorMsg, 'PARSE_MEMBER_DETAIL', job.data.url || 'unknown');
          throw error;
        }
      } else if (job.name === 'PROCESS_MP_LIST_PDF') {
        console.log('📄 Processing MP list PDF...');
        const pdfUrl =
          'https://www.parliament.go.ke/sites/default/files/2025-12/List%20of%20Members%20by%20Parties%2013th%20Parliament%20as%20at%2002122025.pdf';
        try {
          const mpsFromPDF = await pdfService.parseMPListPDF(pdfUrl);
          console.log(`✅ Found ${mpsFromPDF.length} MPs in PDF`);
          let savedCount = 0;
          for (const mp of mpsFromPDF) {
            const validatedName = validateName(mp.name);
            const validatedConstituency = validateLocation(mp.constituency);
            const validatedParty = validateParty(mp.party);
            if (!validatedName || !validatedConstituency) {
              console.log(`⚠️ Skipping invalid MP from PDF: "${mp.name}" - Invalid data`);
              continue;
            }
            const updateDoc: any = {
              fullName: validatedName,
              party: validatedParty,
              constituency: validatedConstituency,
              role: 'MP',
              sourceUrls: [pdfUrl],
            };
            const savedMember = await Member.findOneAndUpdate(
              { fullName: validatedName, role: 'MP', constituency: validatedConstituency },
              updateDoc,
              { upsert: true, returnDocument: 'after' },
            );
            if (savedMember) savedCount++;
            if (savedCount % 50 === 0) console.log(`📊 Progress: ${savedCount}/${mpsFromPDF.length} MPs saved`);
          }
          console.log(`✅ Successfully saved ${savedCount} MPs from PDF`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('❌ Failed to process MP list PDF:', errorMsg);
          await screenshotService.captureErrorScreenshot(
            page,
            errorMsg,
            'PROCESS_MP_LIST_PDF',
            'https://www.parliament.go.ke/sites/default/files/2025-12/List%20of%20Members%20by%20Parties%2013th%20Parliament%20as%20at%2002122025.pdf',
          );
          throw error;
        }
      } else if (job.name === 'DISCOVER_GOVERNORS') {
        console.log('🔍 Discovering Kenyan Governors (2017‑2022)...');
        const baseUrl = 'https://cog.go.ke/2017-2022-governors/';
        try {
          await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          await scraperEngine.waitRandom(2000, 3000);
          const pageGovernors = await page.evaluate(() => {
            const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const knownCounties: string[] = [
              'Mombasa', 'Kwale', 'Kilifi', 'Tana River', 'Lamu', 'Taita Taveta',
              'Garissa', 'Wajir', 'Mandera', 'Marsabit', 'Isiolo', 'Meru',
              'Tharaka Nithi', 'Embu', 'Kitui', 'Machakos', 'Makueni', 'Nyandarua',
              'Nyeri', 'Kirinyaga', 'Muranga', 'Kiambu', 'Turkana', 'West Pokot',
              'Samburu', 'Trans Nzoia', 'Uasin Gishu', 'Elgeyo Marakwet', 'Nandi',
              'Baringo', 'Laikipia', 'Nakuru', 'Narok', 'Kajiado', 'Kericho',
              'Bomet', 'Kakamega', 'Vihiga', 'Bungoma', 'Busia', 'Siaya',
              'Kisumu', 'Homa Bay', 'Migori', 'Kisii', 'Nyamira', 'Nairobi',
            ];
            const governors: Array<{
              fullName: string;
              county: string;
              role: string;
              honorifics: string[];
              sourceUrls: string[];
              termStart: number;
              termEnd: number;
              dateAssumedOffice: string;
              lastUpdated: string;
            }> = [];
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line.match(/^H\.?E\.?\s/)) {
                let name = line.replace(/^H\.?E\.?\s*/i, '').trim();
                name = name.replace(/,\s*[A-Z]+$/, '').trim();
                if (!name && i + 1 < lines.length) name = lines[i + 1].trim();
                let county = '';
                for (let j = i; j <= i + 2 && j < lines.length; j++) {
                  const candidate = lines[j];
                  const countyMatch = candidate.match(/County:?\s*([^,\n]+)/i);
                  if (countyMatch) {
                    county = countyMatch[1]?.trim() || '';
                    break;
                  }
                  for (const c of knownCounties) {
                    if (candidate.includes(c)) {
                      county = c;
                      break;
                    }
                  }
                  if (county) break;
                }
                if (name && county) {
                  governors.push({
                    fullName: name,
                    county,
                    role: 'Governor',
                    honorifics: ['H.E.'],
                    sourceUrls: [],
                    termStart: 2017,
                    termEnd: 2022,
                    dateAssumedOffice: '2017-08-09T00:00:00.000Z',
                    lastUpdated: new Date().toISOString(),
                  });
                }
              }
            }
            return governors;
          });
          console.log(`✅ Found ${pageGovernors.length} Governors`);
          let savedCount = 0;
          for (const governor of pageGovernors) {
            try {
              const validatedName = validateName(governor.fullName);
              const validatedCounty = validateLocation(governor.county);
              if (!validatedName || !validatedCounty) {
                console.log(`⚠️ Skipping invalid governor: "${governor.fullName}" from "${governor.county}"`);
                continue;
              }
              const saved = await Member.findOneAndUpdate(
                { role: 'Governor', county: validatedCounty },
                { ...governor, fullName: validatedName, county: validatedCounty },
                { upsert: true, returnDocument: 'after' },
              );
              if (saved) savedCount++;
            } catch (saveError) {
              const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
              console.error(`Failed to save governor ${governor.fullName}:`, errorMessage);
            }
          }
          console.log(`✅ Saved ${savedCount} Governors`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('❌ Error discovering Governors:', errorMsg);
          await screenshotService.captureErrorScreenshot(page, errorMsg, 'DISCOVER_GOVERNORS', 'https://www.cog.go.ke/');
        }
      } else if (job.name === 'PARSE_GOVERNOR_DETAIL') {
        const { url, role, county, governorName } = job.data;
        console.log(`🔍 Parsing Governor details for ${county} from: ${url}`);
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await scraperEngine.waitRandom(2000, 3000);
          const governorDetails = await page.evaluate((passedCounty, passedName) => {
            const pageText = document.body.innerText;
            const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const details: any = {
              email: null,
              phone: null,
              website: null,
              deputyGovernor: null,
              socialMedia: {},
              bio: null,
              cabinet: [],
              countyHeadquarters: null,
              countyWebsite: null,
              countyEmail: null,
              countyPhone: null,
            };
            // Deputy Governor
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes('deputy governor')) {
                if (i + 1 < lines.length) {
                  const nextLine = lines[i + 1];
                  details.deputyGovernor = nextLine.includes('H.E.') ? nextLine.replace(/H\.?E\.?\s*/i, '').trim() : nextLine.trim();
                }
                break;
              }
            }
            if (!details.deputyGovernor) {
              const deputyMatch = pageText.match(/(?:Deputy\s+Governor|Deputy\s+Governors?)[:\s]*\n*\s*H\.?E\.?\s*([^\n]+)/i);
              if (deputyMatch) details.deputyGovernor = deputyMatch[1].trim();
            }
            // Email
            const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
            const emailMatches = pageText.match(emailRegex);
            if (emailMatches) {
              details.email = emailMatches.find(e => !e.includes('info@') && !e.includes('admin@') && !e.includes('webmaster@') && !e.includes('support@')) || emailMatches[0];
            }
            // Phone
            const phoneRegex = /(?:\+?254|0)[7-9][0-9]{8}/g;
            const phoneMatches = pageText.match(phoneRegex);
            if (phoneMatches) details.phone = phoneMatches[0];
            // Website
            const websiteLinks = Array.from(document.querySelectorAll('a'));
            const govKeLink = websiteLinks.find(a => a.href && (a.href.includes('go.ke') || a.href.includes('.co.ke')) && !a.href.includes('facebook') && !a.href.includes('twitter') && !a.href.includes('instagram') && !a.href.includes('youtube'));
            if (govKeLink) details.website = govKeLink.href;
            // County Website
            const countyWebsiteMatch = pageText.match(/(?:County\s+Website|Website)[:\s]*([^\n]+)/i);
            if (countyWebsiteMatch) details.countyWebsite = countyWebsiteMatch[1].trim();
            const countyEmailMatch = pageText.match(/(?:County\s+Email|Email)[:\s]*([^\n]+)/i);
            if (countyEmailMatch) details.countyEmail = countyEmailMatch[1].trim();
            const countyPhoneMatch = pageText.match(/(?:County\s+Phone|Phone)[:\s]*([^\n]+)/i);
            if (countyPhoneMatch) details.countyPhone = countyPhoneMatch[1].trim();
            const hqMatch = pageText.match(/(?:Headquarters|County\s+Headquarters)[:\s]*([^\n]+)/i);
            if (hqMatch) details.countyHeadquarters = hqMatch[1].trim();
            // Social Media
            const socialMedia: any = {};
            const socialLinks = Array.from(document.querySelectorAll('a'));
            socialLinks.forEach(link => {
              const href = (link as HTMLAnchorElement).href;
              if (href.includes('twitter.com') || href.includes('x.com')) socialMedia.twitter = href;
              if (href.includes('facebook.com')) socialMedia.facebook = href;
              if (href.includes('instagram.com')) socialMedia.instagram = href;
              if (href.includes('youtube.com')) socialMedia.youtube = href;
            });
            if (Object.keys(socialMedia).length > 0) details.socialMedia = socialMedia;
            // Bio
            const paragraphs = Array.from(document.querySelectorAll('p'));
            for (const p of paragraphs) {
              const text = p.textContent || '';
              if (text.length > 200 && (text.includes('born') || text.includes('education') || text.includes('previous'))) {
                details.bio = text;
                break;
              }
            }
            if (!details.bio) {
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes('biography') || lines[i].toLowerCase().includes('profile')) {
                  const bioLines = [];
                  for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                    if (lines[j].length > 0 && !lines[j].toLowerCase().includes('contact')) bioLines.push(lines[j]);
                    else break;
                  }
                  if (bioLines.length > 0) details.bio = bioLines.join(' ');
                  break;
                }
              }
            }
            // Cabinet
            const cabinet: any[] = [];
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes('executive committee') || lines[i].toLowerCase().includes('cec') || lines[i].toLowerCase().includes('cabinet')) {
                let j = i + 1;
                while (j < lines.length && j < i + 20) {
                  const line = lines[j];
                  if (line.includes('-') || line.includes('–') || line.includes('—')) {
                    const parts = line.split(/[-–—]/);
                    if (parts.length >= 2) cabinet.push({ position: parts[0].trim(), appointee: parts[1].trim() });
                  } else if (line.length > 0 && !line.toLowerCase().includes('committee') && !line.toLowerCase().includes('contact')) {
                    cabinet.push({ position: line, appointee: 'Unknown' });
                  }
                  if (line.toLowerCase().includes('contact') || line.toLowerCase().includes('biography') || line.match(/^[A-Z\s]{5,}$/)) break;
                  j++;
                }
                break;
              }
            }
            if (cabinet.length > 0) details.cabinet = cabinet.slice(0, 15);
            const termMatch = pageText.match(/(?:Term|Tenure)[:\s]*(\d{4})\s*[-–—]\s*(\d{4})/i);
            if (termMatch) {
              details.termStart = parseInt(termMatch[1]);
              details.termEnd = parseInt(termMatch[2]);
            }
            console.log(`   Found details - Deputy: ${details.deputyGovernor ? '✅' : '❌'}, Email: ${details.email ? '✅' : '❌'}, Phone: ${details.phone ? '✅' : '❌'}, Cabinet: ${details.cabinet?.length || 0} members`);
            return details;
          }, county, governorName);
          const updateFields: any = {};
          if (governorDetails.email) updateFields.email = governorDetails.email;
          if (governorDetails.phone) updateFields.phone = governorDetails.phone;
          if (governorDetails.website) updateFields.website = governorDetails.website;
          if (governorDetails.deputyGovernor) updateFields.deputyGovernor = governorDetails.deputyGovernor;
          if (governorDetails.socialMedia && Object.keys(governorDetails.socialMedia).length > 0) updateFields.socialMedia = governorDetails.socialMedia;
          if (governorDetails.bio) updateFields.bio = governorDetails.bio;
          if (governorDetails.cabinet && governorDetails.cabinet.length > 0) updateFields.cabinet = governorDetails.cabinet;
          if (governorDetails.countyHeadquarters) updateFields.countyHeadquarters = governorDetails.countyHeadquarters;
          if (governorDetails.countyWebsite) updateFields.countyWebsite = governorDetails.countyWebsite;
          if (governorDetails.countyEmail) updateFields.countyEmail = governorDetails.countyEmail;
          if (governorDetails.countyPhone) updateFields.countyPhone = governorDetails.countyPhone;
          if (governorDetails.termStart) updateFields.termStart = governorDetails.termStart;
          if (governorDetails.termEnd) updateFields.termEnd = governorDetails.termEnd;
          updateFields.lastUpdated = new Date();
          updateFields.sourceUrls = [url];
          if (Object.keys(updateFields).length > 1) {
            const updated = await Member.findOneAndUpdate({ role: 'Governor', county: county }, { $set: updateFields }, { returnDocument: 'after' });
            if (updated) {
              console.log(`✅ Updated details for ${county} Governor`);
              console.log(`   └─ Deputy Governor: ${governorDetails.deputyGovernor || 'Not found'}`);
              console.log(`   └─ Email: ${governorDetails.email || 'Not found'}`);
              console.log(`   └─ Phone: ${governorDetails.phone || 'Not found'}`);
              console.log(`   └─ Cabinet Members: ${governorDetails.cabinet?.length || 0}`);
              console.log(`   └─ County Website: ${governorDetails.countyWebsite || 'Not found'}`);
            }
          } else {
            console.log(`⚠️ No new details found for ${county} Governor`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ Error parsing Governor details for ${county}:`, errorMsg);
          await screenshotService.captureErrorScreenshot(page, errorMsg, 'PARSE_GOVERNOR_DETAIL', job.data.url || 'unknown');
        }
      } else if (job.name === 'SCRAPE_COG_LEADERSHIP') {
        console.log('🏛️ Scraping Council of Governors leadership positions...');
        try {
          await page.goto('https://www.cog.go.ke/', { waitUntil: 'networkidle2', timeout: 60000 });
          await scraperEngine.waitRandom(2000, 3000);
          const committeeLeaders = [
            { committee: 'Finance, Planning and Economic Affairs', governor: 'Fernandes Barasa', county: 'Kakamega' },
            { committee: 'Health', governor: 'Abdullswamad Shariff Nassir', county: 'Mombasa' },
            { committee: 'Agriculture and Livestock Development', governor: 'Kenneth Lusaka', county: 'Bungoma' },
            { committee: 'Environment, Forestry and Climate Change', governor: 'Wilber Ottichilo', county: 'Vihiga' },
            { committee: 'Resource Mobilization and Partnerships', governor: 'Stephen Sang', county: 'Nandi' },
            { committee: 'ASAL and Disaster Risk Management', governor: 'Nathif Jama', county: 'Garissa' },
            { committee: 'Blue Economy', governor: 'Paul Otuoma', county: 'Busia' },
            { committee: 'Education', governor: 'Erick Mutai', county: 'Kericho' },
            { committee: 'Gender, Youth, Sports, Culture and Social Services', governor: 'Simon Kachapin', county: 'West Pokot' },
            { committee: 'Human Resources, Labour and Social Welfare', governor: 'Gladys Wanga', county: 'Homa Bay' },
            { committee: 'Information, Communication Technology and Knowledge Management', governor: 'Wisley Rotich', county: 'Elgeyo Marakwet' },
            { committee: 'Land, Housing and Urban Development', governor: "Peter Anyang' Nyong'o", county: 'Kisumu' },
            { committee: 'Legal, Constitutional Affairs and Intergovernmental Relations', governor: 'Ochilo Ayacko', county: 'Migori' },
            { committee: 'Security and Foreign Affairs', governor: 'Paul Simba Arati', county: 'Kisii' },
            { committee: 'Tourism and Wildlife', governor: 'Patrick Ole Ntutu', county: 'Narok' },
            { committee: 'Trade and Cooperatives', governor: 'Moses Badilisha Kiarie', county: 'Nyandarua' },
            { committee: 'Transport, Infrastructure and Energy', governor: 'Kimani Wamatangi', county: 'Kiambu' },
            { committee: 'Water and Natural Resources Management', governor: 'Joshua Irungu', county: 'Laikipia' },
          ];
          for (const leader of committeeLeaders) {
            await Member.findOneAndUpdate(
              { role: 'Governor', $or: [{ county: leader.county }, { fullName: { $regex: leader.governor, $options: 'i' } }] },
              { $set: { cogCommittee: { name: leader.committee, role: 'Chairperson' } } },
              { returnDocument: 'after' },
            );
          }
          const cogLeadership = [
            { position: 'Chairperson', governor: 'Ahmed Abdullahi', county: 'Wajir' },
            { position: 'Vice Chairperson', governor: 'Mutahi Kahiga', county: 'Nyeri' },
            { position: 'Chief Whip', governor: 'Muthomi Njuki', county: 'Tharaka Nithi' },
          ];
          for (const leader of cogLeadership) {
            await Member.findOneAndUpdate(
              { role: 'Governor', $or: [{ county: leader.county }, { fullName: { $regex: leader.governor, $options: 'i' } }] },
              { $set: { cogPosition: leader.position } },
            );
          }
          console.log('✅ Updated CoG leadership positions');
        } catch (error) {
          console.error('❌ Error scraping CoG leadership:', error);
        }
      }

      console.log('='.repeat(50));
      console.log(`✅ JOB ${job.id} COMPLETED`);
      console.log('='.repeat(50));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ JOB ERROR:', errorMsg);
      await screenshotService.captureErrorScreenshot(page, errorMsg, job.name || 'unknown_job', page?.url() || 'unknown');
      throw error;
    } finally {
      if (page) await page.close().catch(console.error);
    }
  },
  { connection, concurrency: 2 },
);

worker.on('completed', job => {
  console.log(`✅ Job ${job.id} (${job.name}) completed successfully`);
});
worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} (${job?.name}) failed:`, err.message);
});
worker.on('error', err => {
  console.error('❌ Worker error:', err);
});

console.log('🚀 Worker is active and listening for jobs...');