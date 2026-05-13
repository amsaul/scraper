import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { scraperEngine } from '../services/scraper';
import Member from '../models/members';
import { connectDB } from '../config/db';
import { pdfService } from '../services/pdfServices';
import { scrapeQueue, pushQueue } from '../services/queue';
import { JSDOM } from 'jsdom'; // You may need to install: npm install jsdom @types/jsdom

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
    maxRetriesPerRequest: null 
});

const worker = new Worker('verivote-scrape-queue', async (job: Job) => {
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
      
      // Define the type for MP data
      interface TableMP {
        name: string;
        constituency: string;
        party: string;
        profileUrl: string | null;
      }
      
      while (hasMorePages) {
        // Construct URL with page parameter
        const url = currentPage === 1 
          ? baseUrl 
          : `${baseUrl}?page=${currentPage - 1}`;
        
        console.log(`\n📄 ===== PAGE ${currentPage} =====`);
        console.log(`🌐 Navigating to: ${url}`);
        
        await page.goto(url, { 
          waitUntil: 'networkidle2',
          timeout: 60000 
        });
        
        await scraperEngine.waitRandom(3000, 5000);
        
        // Extract MPs from current page with proper typing
        console.log(`🔍 Extracting MP data from page ${currentPage}...`);
        
        const pageMembers: TableMP[] = await page.evaluate(() => {
          const rows = document.querySelectorAll('table tbody tr');
          const members: TableMP[] = [];
          
          // First, try to determine which column is which by looking at headers
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
            // Ensure we have enough cells
            const maxIndex = Math.max(nameIndex, constituencyIndex, partyIndex);
            if (cells.length <= maxIndex) return;
            
            // Get the profile link anywhere in the row, not only in the name column
            const link = Array.from(row.querySelectorAll('a')).find((anchor) => {
              const href = anchor.getAttribute('href') || '';
              return href.includes('/the-national-assembly/hon-') ||
                     href.includes('/the-national-assembly/women-representative') ||
                     href.includes('/the-national-assembly/member/') ||
                     href.includes('/the-national-assembly/amb-');
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
            
            // VALIDATION: Check if party value looks like a county name and was swapped by the table layout
            const counties = [
              'NAIROBI', 'MOMBASA', 'KISUMU', 'NAKURU', 'KIAMBU', 'MACHAKOS',
              'MURANGA', 'KITUI', 'MAKUENI', 'TURKANA', 'WEST POKOT', 'SAMBURU',
              'TRANS NZOIA', 'UASIN GISHU', 'ELGEYO MARAKWET', 'NANDI', 'BARINGO',
              'LAIKIPIA', 'KERICHO', 'BOMET', 'KAKAMEGA', 'VIHIGA', 'BUNGOMA',
              'BUSIA', 'SIAYA', 'KISII', 'NYAMIRA', 'HOMA BAY', 'MIGORI',
              'NYERI', 'KIRINYAGA', 'MURANG\'A', 'KIAMBU', 'MARSABIT'
            ];
            
            if (party && counties.includes(party.toUpperCase()) && !counties.includes(constituency.toUpperCase())) {
              console.log(`🔄 Swapping party and constituency for ${name}: party=${party}, constituency=${constituency}`);
              const temp = party;
              party = constituency;
              constituency = temp;
            }
            
            // Skip header rows or empty rows
            if (name && !name.toLowerCase().includes('name')) {
              members.push({ 
                name, 
                constituency, 
                party,
                profileUrl 
              });
            }
          });
          return members;
        });

        console.log(`📊 Found ${pageMembers.length} MPs on page ${currentPage}`);
        console.log('─'.repeat(60));
        
        // Save MPs from this page with detailed logging
        for (let i = 0; i < pageMembers.length; i++) {
          const mp = pageMembers[i];
          
          console.log(`\n👤 MP #${totalMPsExtracted + i + 1}:`);
          console.log(`   └─ Name: ${mp.name}`);
          console.log(`   └─ Constituency: ${mp.constituency}`);
          console.log(`   └─ Party: ${mp.party}`);
          console.log(`   └─ Profile URL: ${mp.profileUrl || 'N/A'}`);
          
          // Save to database
          const savedMember = await Member.findOneAndUpdate(
            { fullName: mp.name },
            {
              fullName: mp.name,
              party: mp.party,
              county: mp.constituency,
              constituency: mp.constituency,
              role: 'MP',
              sourceUrls: mp.profileUrl ? [mp.profileUrl] : [url]
            },
            { upsert: true, new: true, returnDocument: 'after' }
          );
          
          console.log(`   └─ Status: ✅ Saved (ID: ${savedMember._id})`);
          
          // If there's a profile URL, queue it for detailed parsing
          if (mp.profileUrl) {
            await scrapeQueue.add('PARSE_MEMBER_DETAIL', { 
              url: mp.profileUrl, 
              role: 'MP',
              discoveredAt: new Date().toISOString()
            });
            console.log(`   └─ Queue: 📤 Added for detail parsing`);
          }
          
          totalMPsExtracted++;
        }
        
        console.log('\n' + '─'.repeat(60));
        
        // Check if there's a "Next" page link
        hasMorePages = await page.evaluate(() => {
          const nextLink = document.querySelector('a[rel="next"]');
          const lastPageLink = document.querySelector('li.pager__item--last a');
          return !!(nextLink || lastPageLink);
        });
        
        if (hasMorePages) {
          console.log(`➡️ Moving to next page...`);
          currentPage++;
        } else {
          console.log(`✅ No more pages. Processed ${currentPage} pages total.`);
        }
      }
      
      console.log('\n' + '='.repeat(60));
      console.log(`🎉 FINAL SUMMARY:`);
      console.log(`   ├─ Total MPs extracted: ${totalMPsExtracted}`);
      console.log(`   ├─ Total pages processed: ${currentPage}`);
      console.log('='.repeat(60));
      
      // Original link extraction code (optional)
      console.log('\n🔍 Searching for additional MP profile links...');
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
            if (!links.includes(href) && !href.includes('.pdf')) {
              links.push(href);
            }
          }
        });
        
        return links;
      });
      
      console.log(`✅ Found ${mpLinks.length} additional profile links`);
    }

    else if (job.name === 'CHECK_HANSARD') {
      console.log('📄 Checking for new Hansard documents...');
      
      // Navigate to Hansard section
      await page.goto('https://hansardna.parliament.go.ke/home', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });
      
      // Find latest Hansard PDF links
      const hansardLinks = await page.evaluate(() => {
        const links: Array<{ url: string; date: string; title: string }> = [];
        
        document.querySelectorAll('a[href$=".pdf"]').forEach(link => {
          const href = (link as HTMLAnchorElement).href;
          const text = link.textContent || '';
          
          // Check if it's a Hansard document
          if (href.includes('hansard') || text.toLowerCase().includes('hansard')) {
            // Try to extract date from text or filename
            const dateMatch = text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/) || 
                            href.match(/\d{4}-\d{2}-\d{2}/);
            
            links.push({
              url: href,
              date: dateMatch ? dateMatch[0] : new Date().toISOString().split('T')[0],
              title: text || 'Hansard Document'
            });
          }
        });
        
        return links.slice(0, 10); // Get last 10 documents
      });
      
      console.log(`📄 Found ${hansardLinks.length} Hansard documents`);
      
      for (const link of hansardLinks) {
        // Check if we've already processed this document
        const existingMember = await Member.findOne({
          'hansardContributions.transcriptUrl': link.url
        });
        
        if (!existingMember) {
          // Add to queue for processing
          await scrapeQueue.add('PROCESS_HANSARD', {
            url: link.url,
            date: link.date,
            topic: link.title,
            discoveredAt: new Date().toISOString()
          });
          console.log(`📄 Added new Hansard to queue: ${link.title}`);
        }
      }
    }

    else if (job.name === 'RETRY_FAILED_PUSHES') {
      console.log('🔄 Retrying failed push jobs...');
      
      // Find members with failed push status (older than 1 hour)
      const failedMembers = await Member.find({ 
        pushStatus: 'failed',
        lastPushAttempt: { $lt: new Date(Date.now() - 60 * 60 * 1000) } // Older than 1 hour
      }).limit(50); // Limit to 50 per run
      
      console.log(`🔄 Found ${failedMembers.length} failed members to retry`);
      
      for (const member of failedMembers) {
        try {
          await pushQueue.add('PUSH_TO_VERIVOTE', {
            member: member.toObject ? member.toObject() : member,
            action: 'retry',
            originalId: member._id
          });
          console.log(`📤 Added retry job for: ${member.fullName}`);
        } catch (error) {
          console.error(`❌ Failed to add retry job for ${member.fullName}:`, error);
        }
      }
    }

    else if (job.name === 'REFRESH_MEMBERS') {
      console.log('🔄 Refreshing member data...');
      
      // Get all members from DB
      const members = await Member.find({ role: 'MP' }).limit(100);
      
      console.log(`🔄 Queueing refresh for ${members.length} members`);
      
      // Re-queue them for detail parsing to get updated info
      for (const member of members) {
        if (member.sourceUrls && member.sourceUrls.length > 0) {
          await scrapeQueue.add('PARSE_MEMBER_DETAIL', {
            url: member.sourceUrls[0],
            role: 'MP',
            refresh: true,
            memberId: member._id
          });
        }
      }
    }
    
    else if (job.name === 'PARSE_MEMBER_DETAIL') {
      const { url, role } = job.data;
      console.log(`🔍 Parsing member detail from: ${url}`);
      
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000 
        });

        await scraperEngine.waitRandom(2000, 3000);

        // Define types for the extracted data
        // Helper function to parse year strings to Date objects
        const parseYearToDate = (yearStr: string): Date | null => {
          if (!yearStr || yearStr.toLowerCase() === 'date' || yearStr.toLowerCase() === 'to' || yearStr.toLowerCase() === 'from') {
            return null;
          }
          const yearMatch = yearStr.match(/\d{4}/);
          if (yearMatch) {
            return new Date(`${yearMatch[0]}-01-01`);
          }
          return null;
        };

        // Define types for extracted data (using strings for dates since they come from page.evaluate)
        type EducationItem = {
          from: string;
          to: string;
          institution: string;
          qualification: string;
        };

        type ExperienceItem = {
          from: string;
          to: string;
          organization: string;
          title: string;
        };

        type CommitteeItem = {
          from: string;
          to: string;
          name: string;
          role: string;
        };

        type MemberDetailData = {
          fullName: string;
          party: string;
          constituency: string;
          county: string;
          role: string;
          sourceUrls: string[];
          bio: string;
          email: string;
          phone: string;
          website: string;
          profileImage: string;
          dateOfBirth: string | null;
          education: Array<{ from: string; to: string; institution: string; qualification: string }>;
          experience: Array<{ from: string; to: string; organization: string; title: string }>;
          committees: Array<{ from: string; to: string; name: string; role: string }>;
          professionalAffiliations: string[];
          honours: string[];
        };

        // ===== EXTRACT ALL DATA IN ONE PAGE.EVALUATE =====
        const memberData: MemberDetailData = await page.evaluate((passedUrl, passedRole) => {
          const titleText = document.querySelector('h1')?.textContent?.trim() || document.title.split('|')[0].trim();
          let fullName = titleText.replace(/^Hon\.?\s*/i, '').trim();
          if (!fullName) {
            fullName = passedUrl.split('/').pop()?.replace(/-/g, ' ').replace(/^hon\.?\s*/i, '').trim() || 'Unknown';
          }

          const pageText = document.body.innerText || '';

          const partyMatch = pageText.match(/Party\s*[:\-]\s*([A-Za-z0-9\- ]+)/i);
          let party = 'Independent';
          if (partyMatch) {
            party = partyMatch[1].trim();
          } else {
            const knownParties = ['UDA', 'ODM', 'ANC', 'Jubilee', 'WDM', 'UPA', 'KANU', 'FORD-K', 'CCM', 'DAP-K', 'JP', 'PAA', 'TSP', 'MDG', 'KUP', 'MCCP', 'NAP-K', 'NOPEU', 'GDDP'];
            for (const p of knownParties) {
              if (pageText.includes(p)) {
                party = p;
                break;
              }
            }
          }

          let constituency = 'N/A';
          const constituencyMatch = pageText.match(/Constituency\s*[:\-]\s*([A-Za-z0-9 '\/]+)/i);
          if (constituencyMatch) {
            constituency = constituencyMatch[1].trim();
          } else {
            const lines = pageText.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes('constituency')) {
                if (i + 1 < lines.length) {
                  constituency = lines[i + 1].trim();
                  break;
                }
              }
            }
          }

          const bio = document.querySelector('div.field--name-body p')?.textContent?.trim() ||
                      document.querySelector('article p')?.textContent?.trim() ||
                      document.querySelector('p')?.textContent?.trim() || '';

          const profileImage = (() => {
            const img = Array.from(document.querySelectorAll('img')).find(i => {
              const src = i.getAttribute('src') || '';
              return src.includes('/sites/default/files/styles/mp_photo') || src.includes('member_photo') || src.toLowerCase().includes('mp_');
            });
            return img ? new URL(img.getAttribute('src') || '', window.location.origin).href : '';
          })();

          const emailAnchor = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
            .map(a => (a as HTMLAnchorElement).href.replace(/^mailto:/i, '').trim())
            .find(Boolean) || '';

          const phoneAnchor = Array.from(document.querySelectorAll('a[href^="tel:"]'))
            .map(a => (a as HTMLAnchorElement).href.replace(/^tel:/i, '').trim())
            .find(Boolean) || '';

          const websiteAnchor = Array.from(document.querySelectorAll('a[href^="http"]'))
            .map(a => (a as HTMLAnchorElement).href)
            .find(href => !href.includes('parliament.go.ke') && !href.includes('mailto:') && !href.includes('tel:')) || '';

          let dateOfBirth: string | null = null;
          const dobMatch = pageText.match(/Born\s*[:\-]?\s*([A-Za-z0-9 ,]+)/i);
          if (dobMatch) {
            dateOfBirth = dobMatch[1].trim();
          }

          // ===== 1. Extract Academic Education =====
          const education: Array<{ from: string; to: string; institution: string; qualification: string }> = [];
          const academicTables = Array.from(document.querySelectorAll('table')).filter(table => {
            const firstRow = table.querySelector('tr');
            if (!firstRow) return false;
            const cells = Array.from(firstRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
            return cells.some(cell => /Institution/i.test(cell)) && cells.some(cell => /Qualification/i.test(cell));
          });

          academicTables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            // Skip header row (first row)
            for (let i = 1; i < rows.length; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 4) {
                const fromYear = cells[0]?.textContent?.trim() || '';
                const toYear = cells[1]?.textContent?.trim() || '';
                const institution = cells[2]?.textContent?.trim() || '';
                const qualification = cells[3]?.textContent?.trim() || '';
                
                // Skip if institution or qualification is empty or looks like a header
                if (!institution || !qualification || 
                    /^(Institution|From|To|Qualification)$/i.test(institution) ||
                    /^(Institution|From|To|Qualification)$/i.test(qualification)) {
                  continue;
                }
                
                const item = {
                  from: fromYear,
                  to: toYear,
                  institution,
                  qualification
                };
                
                // Only add if not duplicate
                if (item.institution && item.qualification) {
                  const isDuplicate = education.some(existing => 
                    existing.institution === item.institution && 
                    existing.qualification === item.qualification &&
                    existing.from === item.from
                  );
                  if (!isDuplicate) {
                    education.push(item);
                  }
                }
              }
            }
          });

          // ===== 2. Extract Employment History =====
          const experience: Array<{ from: string; to: string; organization: string; title: string }> = [];
          const employmentTables = Array.from(document.querySelectorAll('table')).filter(table => {
            const firstRow = table.querySelector('tr');
            if (!firstRow) return false;
            const cells = Array.from(firstRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
            return cells.some(cell => /Employer/i.test(cell) || /Organization/i.test(cell)) && 
                   cells.some(cell => /Position|Title/i.test(cell));
          });

          employmentTables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            // Skip header row
            for (let i = 1; i < rows.length; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 4) {
                const fromYear = cells[0]?.textContent?.trim() || '';
                const toYear = cells[1]?.textContent?.trim() || '';
                const organization = cells[2]?.textContent?.trim() || '';
                const title = cells[3]?.textContent?.trim() || '';
                
                // Skip if organization or title is empty or looks like a header
                if (!organization || !title || 
                    /^(Organization|From|To|Position|Title|Employer)$/i.test(organization) ||
                    /^(Organization|From|To|Position|Title|Employer)$/i.test(title)) {
                  continue;
                }
                
                const item = {
                  from: fromYear,
                  to: toYear,
                  organization,
                  title
                };
                
                // Only add if not empty and not duplicate
                if (item.organization && item.title) {
                  const isDuplicate = experience.some(existing => 
                    existing.organization === item.organization && 
                    existing.title === item.title &&
                    existing.from === item.from
                  );
                  if (!isDuplicate) {
                    experience.push(item);
                  }
                }
              }
            }
          });

          // ===== 3. Extract Committee Memberships =====
          const committees: Array<{ from: string; to: string; name: string; role: string }> = [];
          const committeeTables = Array.from(document.querySelectorAll('table')).filter(table => {
            const firstRow = table.querySelector('tr');
            if (!firstRow) return false;
            const cells = Array.from(firstRow.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
            return cells.some(cell => /Committee/i.test(cell)) && 
                   cells.some(cell => /Position|Role/i.test(cell));
          });

          committeeTables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            // Skip header row
            for (let i = 1; i < rows.length; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 4) {
                const fromYear = cells[0]?.textContent?.trim() || '';
                const toYear = cells[1]?.textContent?.trim() || '';
                const name = cells[2]?.textContent?.trim() || '';
                const role = cells[3]?.textContent?.trim() || '';
                
                // Skip if name or role is empty or looks like a header
                if (!name || !role || 
                    /^(Committee|From|To|Position|Role)$/i.test(name) ||
                    /^(Committee|From|To|Position|Role)$/i.test(role)) {
                  continue;
                }
                
                const item = {
                  from: fromYear,
                  to: toYear,
                  name,
                  role
                };
                
                // Only add if not empty and not duplicate
                if (item.name && item.role) {
                  const isDuplicate = committees.some(existing => 
                    existing.name === item.name && 
                    existing.role === item.role &&
                    existing.from === item.from
                  );
                  if (!isDuplicate) {
                    committees.push(item);
                  }
                }
              }
            }
          });

          // ===== 4. Extract Professional Affiliations =====
          const professionalAffiliations: string[] = [];
          const profAffMatch = pageText.match(/Professional Affiliation[s]?\s*[:\-]\s*(.+?)(?=\n\n|\n[A-Z]|$)/i);
          if (profAffMatch) {
            const affiliations = profAffMatch[1].trim().split(/[,;]/).map(aff => aff.trim()).filter(aff => aff.length > 0);
            professionalAffiliations.push(...affiliations);
          }

          // ===== 5. Extract Honours/Awards =====
          const honours: string[] = [];
          
          // Extract from name (like CBS, EGH, etc.)
          const nameHonours = fullName.match(/(CBS|EGH|CBE|OBE|MBS|MBE|MPH|PhD|Dr\.?)/g) || [];
          honours.push(...nameHonours);
          
          // Extract from text patterns
          const honourMatches = pageText.match(/Honours?\/?Awards?\s*[:\-]\s*(.+?)(?=\n\n|\n[A-Z]|$)/i);
          if (honourMatches) {
            const extractedHonours = honourMatches[1].trim().split(/[,;]/).map(h => h.trim()).filter(h => h.length > 0);
            honours.push(...extractedHonours);
          }
          
          // Extract awards
          const awardMatches = pageText.match(/Awards?\s*[:\-]\s*(.+?)(?=\n\n|\n[A-Z]|$)/i);
          if (awardMatches) {
            const extractedAwards = awardMatches[1].trim().split(/[,;]/).map(a => a.trim()).filter(a => a.length > 0);
            honours.push(...extractedAwards);
          }
          
          // Deduplicate honours
          const uniqueHonours = [...new Set(honours.map(h => h.toUpperCase()))].map(h => 
            honours.find(orig => orig.toUpperCase() === h) || h
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
            honours: uniqueHonours
          };
        }, url, role); // End of page.evaluate

        // ===== Helper function to convert year strings to Date objects =====
        const convertToDate = (yearStr: string): Date | null => {
          if (!yearStr || yearStr.toLowerCase() === 'date' || yearStr.toLowerCase() === 'to' || yearStr.toLowerCase() === 'from') {
            return null;
          }
          const yearMatch = yearStr.match(/\d{4}/);
          if (yearMatch) {
            return new Date(`${yearMatch[0]}-01-01`);
          }
          return null;
        };

        // ===== Log the extracted data =====
        console.log(`📊 Extracted: ${memberData.fullName}`);
        console.log(`   └─ Party: ${memberData.party}`);
        console.log(`   └─ Constituency: ${memberData.constituency}`);
        console.log(`   └─ Education entries: ${memberData.education?.length || 0}`);
        console.log(`   └─ Experience entries: ${memberData.experience?.length || 0}`);
        console.log(`   └─ Committees entries: ${memberData.committees?.length || 0}`);
        console.log(`   └─ Professional Affiliations: ${memberData.professionalAffiliations?.length || 0}`);
        console.log(`   └─ Honours: ${memberData.honours?.length || 0}`);

        // ===== Convert dates and prepare data for save =====
        const convertedEducation = memberData.education?.map(edu => ({
          from: convertToDate(edu.from),
          to: convertToDate(edu.to),
          institution: edu.institution,
          qualification: edu.qualification
        })) || [];

        const convertedExperience = memberData.experience?.map(exp => ({
          from: convertToDate(exp.from),
          to: convertToDate(exp.to),
          organization: exp.organization,
          title: exp.title
        })) || [];

        const convertedCommittees = memberData.committees?.map(com => ({
          from: convertToDate(com.from),
          to: convertToDate(com.to),
          name: com.name,
          role: com.role
        })) || [];

        // ===== Save to Database =====
        const savedMember = await Member.findOneAndUpdate(
          { fullName: memberData.fullName, role: memberData.role },
          {
            fullName: memberData.fullName,
            party: memberData.party,
            county: memberData.constituency,
            constituency: memberData.constituency,
            role: memberData.role,
            sourceUrls: memberData.sourceUrls,
            bio: memberData.bio,
            email: memberData.email || undefined,
            phone: memberData.phone || undefined,
            website: memberData.website || undefined,
            profileImage: memberData.profileImage || undefined,
            dateOfBirth: memberData.dateOfBirth ? new Date(memberData.dateOfBirth) : undefined,
            education: convertedEducation,
            experience: convertedExperience,
            committees: convertedCommittees,
            professionalAffiliations: memberData.professionalAffiliations,
            honours: memberData.honours
          },
          { upsert: true, returnDocument: 'after' }
        );

        if (savedMember) {
          console.log(`✅ Saved to DB: ${memberData.fullName}`);
          
          // ===== Push to queue if needed =====
          try {
            await pushQueue.add('PUSH_TO_VERIVOTE', {
              member: savedMember.toObject ? savedMember.toObject() : savedMember,
              action: 'update'
            });
            console.log(`📤 Added to push queue: ${memberData.fullName}`);
          } catch (pushError) {
            console.error('❌ Failed to add to push queue:', pushError);
          }
        }

      } catch (error) {
        console.error(`❌ Error in PARSE_MEMBER_DETAIL:`, error);
        throw error;
      }
    }

    else if (job.name === 'PROCESS_MP_LIST_PDF') {
      console.log('📄 Processing MP list PDF...');
      
      const pdfUrl = 'https://www.parliament.go.ke/sites/default/files/2025-12/List%20of%20Members%20by%20Parties%2013th%20Parliament%20as%20at%2002122025.pdf';
      
      try {
        // Parse the PDF
        const mpsFromPDF = await pdfService.parseMPListPDF(pdfUrl);
        console.log(`✅ Found ${mpsFromPDF.length} MPs in PDF`);
        
        // Save each MP to database
        let savedCount = 0;
        for (const mp of mpsFromPDF) {
          const savedMember = await Member.findOneAndUpdate(
            { fullName: mp.name },
            {
              fullName: mp.name,
              party: mp.party,
              county: mp.constituency, // Using constituency as county
              constituency: mp.constituency,
              role: 'MP',
              sourceUrls: [pdfUrl]
            },
            { upsert: true, new: true, returnDocument: 'after' }
          );
          
          if (savedMember) {
            savedCount++;
            
            // Optionally add to push queue
            try {
              await pushQueue.add('PUSH_TO_VERIVOTE', {
                member: savedMember.toObject ? savedMember.toObject() : savedMember,
                action: 'update'
              });
            } catch (pushError) {
              // Ignore push errors
            }
          }
          
          // Progress log every 50 MPs
          if (savedCount % 50 === 0) {
            console.log(`📊 Progress: ${savedCount}/${mpsFromPDF.length} MPs saved`);
          }
        }
        
        console.log(`✅ Successfully saved ${savedCount} MPs from PDF`);
        
      } catch (error) {
        console.error('❌ Failed to process MP list PDF:', error);
        throw error;
      }
    }

    // ==================== DISCOVER_GOVERNORS ====================
else if (job.name === 'DISCOVER_GOVERNORS') {
  console.log('🔍 Discovering Kenyan Governors (2017‑2022)...');
  
  const baseUrl = 'https://cog.go.ke/2017-2022-governors/';

  try {
    console.log(`🌐 Navigating to ${baseUrl}`);
    await page.goto(baseUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
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
        'Kisumu', 'Homa Bay', 'Migori', 'Kisii', 'Nyamira', 'Nairobi'
      ];
      const governors: Array<{
        fullName: string;
        county: string;
        role: string;
        honorifics: string[];
        sourceUrls: string[];
        termStart: number;
        termEnd: number;
        dateAssumedOffice: string;  // store as string
        lastUpdated: string;
      }> = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^H\.?E\.?\s/)) {
          // Extract name
          let name = line.replace(/^H\.?E\.?\s*/i, '').trim();
          name = name.replace(/,\s*[A-Z]+$/, '').trim();
          if (!name && i + 1 < lines.length) name = lines[i + 1].trim();

          // Find county
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
              dateAssumedOffice: '2017-08-09T00:00:00.000Z', // ISO string
              lastUpdated: new Date().toISOString()
            });
          }
        }
      }
      return governors;
    });

    console.log(`✅ Found ${pageGovernors.length} Governors`);

    // Debug: log the first governor object
    if (pageGovernors.length > 0) {
      console.log('First governor object:', JSON.stringify(pageGovernors[0], null, 2));
    }

    // Save each governor
    let savedCount = 0;
    for (const governor of pageGovernors) {
      try {
        const saved = await Member.findOneAndUpdate(
          { role: 'Governor', county: governor.county },
          governor,
          { upsert: true, new: true, returnDocument: 'after' }
        );
        if (saved) savedCount++;
      } catch (saveError) {
        const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
        console.error(`Failed to save governor ${governor.fullName}:`, errorMessage);
      }
    }
    console.log(`✅ Saved ${savedCount} Governors`);

  } catch (error) {
    console.error('❌ Error discovering Governors:', error);
  }
}

    // ==================== PARSE_GOVERNOR_DETAIL ====================
    else if (job.name === 'PARSE_GOVERNOR_DETAIL') {
      const { url, role, county, governorName } = job.data;
      console.log(`🔍 Parsing Governor details for ${county} from: ${url}`);
      
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        await scraperEngine.waitRandom(2000, 3000);

        const governorDetails = await page.evaluate((passedCounty, passedName) => {
          
          // Get all the text content for regex searching
          const pageText = document.body.innerText;
          const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          
          // Initialize result object
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
            countyPhone: null
          };
          
          // ===== 1. Extract Deputy Governor =====
          // Look for patterns like "H.E Abdi Muhamed Dagane" under "Deputy Governors" section
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes('deputy governor')) {
              // Check the next line for the name
              if (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                // Look for H.E. or name pattern
                if (nextLine.includes('H.E.') || nextLine.includes('H.E')) {
                  details.deputyGovernor = nextLine.replace(/H\.?E\.?\s*/i, '').trim();
                } else {
                  details.deputyGovernor = nextLine.trim();
                }
              }
              break;
            }
          }
          
          // If not found, try regex
          if (!details.deputyGovernor) {
            const deputyMatch = pageText.match(/(?:Deputy\s+Governor|Deputy\s+Governors?)[:\s]*\n*\s*H\.?E\.?\s*([^\n]+)/i);
            if (deputyMatch) {
              details.deputyGovernor = deputyMatch[1].trim();
            }
          }
          
          // ===== 2. Extract Email =====
          const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
          const emailMatches = pageText.match(emailRegex);
          if (emailMatches) {
            // Filter out common non-personal emails
            details.email = emailMatches.find(e => 
              !e.includes('info@') && 
              !e.includes('admin@') &&
              !e.includes('webmaster@') &&
              !e.includes('support@')
            ) || emailMatches[0];
          }
          
          // ===== 3. Extract Phone Numbers =====
          const phoneRegex = /(?:\+?254|0)[7-9][0-9]{8}/g;
          const phoneMatches = pageText.match(phoneRegex);
          if (phoneMatches) {
            details.phone = phoneMatches[0];
          }
          
          // ===== 4. Extract Website =====
          const websiteLinks = Array.from(document.querySelectorAll('a'));
          const govKeLink = websiteLinks.find(a => 
            a.href && (a.href.includes('go.ke') || a.href.includes('.co.ke')) &&
            !a.href.includes('facebook') && !a.href.includes('twitter') &&
            !a.href.includes('instagram') && !a.href.includes('youtube')
          );
          if (govKeLink) {
            details.website = govKeLink.href;
          }
          
          // ===== 5. Extract County Website/Contact =====
          // Look for county-specific website
          const countyWebsiteMatch = pageText.match(/(?:County\s+Website|Website)[:\s]*([^\n]+)/i);
          if (countyWebsiteMatch) {
            details.countyWebsite = countyWebsiteMatch[1].trim();
          }
          
          // Look for county email
          const countyEmailMatch = pageText.match(/(?:County\s+Email|Email)[:\s]*([^\n]+)/i);
          if (countyEmailMatch) {
            details.countyEmail = countyEmailMatch[1].trim();
          }
          
          // Look for county phone
          const countyPhoneMatch = pageText.match(/(?:County\s+Phone|Phone)[:\s]*([^\n]+)/i);
          if (countyPhoneMatch) {
            details.countyPhone = countyPhoneMatch[1].trim();
          }
          
          // Look for county headquarters
          const hqMatch = pageText.match(/(?:Headquarters|County\s+Headquarters)[:\s]*([^\n]+)/i);
          if (hqMatch) {
            details.countyHeadquarters = hqMatch[1].trim();
          }
          
          // ===== 6. Extract Social Media =====
          const socialMedia: any = {};
          const socialLinks = Array.from(document.querySelectorAll('a'));
          socialLinks.forEach(link => {
            const href = (link as HTMLAnchorElement).href;
            if (href.includes('twitter.com') || href.includes('x.com')) socialMedia.twitter = href;
            if (href.includes('facebook.com')) socialMedia.facebook = href;
            if (href.includes('instagram.com')) socialMedia.instagram = href;
            if (href.includes('youtube.com')) socialMedia.youtube = href;
          });
          
          if (Object.keys(socialMedia).length > 0) {
            details.socialMedia = socialMedia;
          }
          
          // ===== 7. Extract Bio/Biography =====
          // Look for paragraphs that might contain biography
          const paragraphs = Array.from(document.querySelectorAll('p'));
          for (const p of paragraphs) {
            const text = p.textContent || '';
            // Look for longer paragraphs that might be bio
            if (text.length > 200 && (text.includes('born') || text.includes('education') || text.includes('previous'))) {
              details.bio = text;
              break;
            }
          }
          
          // If no bio found, look for content after "Biography" heading
          if (!details.bio) {
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes('biography') || lines[i].toLowerCase().includes('profile')) {
                // Collect next few lines as bio
                const bioLines = [];
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                  if (lines[j].length > 0 && !lines[j].toLowerCase().includes('contact')) {
                    bioLines.push(lines[j]);
                  } else {
                    break;
                  }
                }
                if (bioLines.length > 0) {
                  details.bio = bioLines.join(' ');
                  break;
                }
              }
            }
          }
          
          // ===== 8. Extract Cabinet/CECs =====
          // Look for sections about county executive committee
          const cabinet: any[] = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes('executive committee') || 
                lines[i].toLowerCase().includes('cec') || 
                lines[i].toLowerCase().includes('cabinet')) {
              
              // Look for list items after this heading
              let j = i + 1;
              while (j < lines.length && j < i + 20) { // Look at next 20 lines max
                const line = lines[j];
                // Check if this line contains a position and name
                if (line.includes('-') || line.includes('–') || line.includes('—')) {
                  const parts = line.split(/[-–—]/);
                  if (parts.length >= 2) {
                    cabinet.push({
                      position: parts[0].trim(),
                      appointee: parts[1].trim()
                    });
                  }
                } else if (line.length > 0 && !line.toLowerCase().includes('committee') && !line.toLowerCase().includes('contact')) {
                  // If no separator, treat as position only
                  cabinet.push({
                    position: line,
                    appointee: 'Unknown'
                  });
                }
                
                // Stop if we hit another section heading
                if (line.toLowerCase().includes('contact') || 
                    line.toLowerCase().includes('biography') ||
                    line.match(/^[A-Z\s]{5,}$/)) { // ALL CAPS line likely a new section
                  break;
                }
                j++;
              }
              break;
            }
          }
          
          if (cabinet.length > 0) {
            details.cabinet = cabinet.slice(0, 15); // Limit to 15 cabinet members
          }
          
          // ===== 9. Extract Term Information =====
          const termMatch = pageText.match(/(?:Term|Tenure)[:\s]*(\d{4})\s*[-–—]\s*(\d{4})/i);
          if (termMatch) {
            details.termStart = parseInt(termMatch[1]);
            details.termEnd = parseInt(termMatch[2]);
          }
          
          // Log what we found for debugging
          console.log(`   Found details - Deputy: ${details.deputyGovernor ? '✅' : '❌'}, Email: ${details.email ? '✅' : '❌'}, Phone: ${details.phone ? '✅' : '❌'}, Cabinet: ${details.cabinet?.length || 0} members`);
          
          return details;
          
        }, county, governorName);

        // Prepare update object with only fields that have values
        const updateFields: any = {};
        
        if (governorDetails.email) updateFields.email = governorDetails.email;
        if (governorDetails.phone) updateFields.phone = governorDetails.phone;
        if (governorDetails.website) updateFields.website = governorDetails.website;
        if (governorDetails.deputyGovernor) updateFields.deputyGovernor = governorDetails.deputyGovernor;
        if (governorDetails.socialMedia && Object.keys(governorDetails.socialMedia).length > 0) {
          updateFields.socialMedia = governorDetails.socialMedia;
        }
        if (governorDetails.bio) updateFields.bio = governorDetails.bio;
        if (governorDetails.cabinet && governorDetails.cabinet.length > 0) {
          updateFields.cabinet = governorDetails.cabinet;
        }
        if (governorDetails.countyHeadquarters) updateFields.countyHeadquarters = governorDetails.countyHeadquarters;
        if (governorDetails.countyWebsite) updateFields.countyWebsite = governorDetails.countyWebsite;
        if (governorDetails.countyEmail) updateFields.countyEmail = governorDetails.countyEmail;
        if (governorDetails.countyPhone) updateFields.countyPhone = governorDetails.countyPhone;
        if (governorDetails.termStart) updateFields.termStart = governorDetails.termStart;
        if (governorDetails.termEnd) updateFields.termEnd = governorDetails.termEnd;
        
        updateFields.lastUpdated = new Date();
        updateFields.sourceUrls = [url]; // Add the profile URL to sourceUrls

        // Update the governor record with details
        if (Object.keys(updateFields).length > 1) { // More than just lastUpdated
          const updated = await Member.findOneAndUpdate(
            { role: 'Governor', county: county },
            { $set: updateFields },
            { new: true }
          );

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
        console.error(`❌ Error parsing Governor details for ${county}:`, error);
        // Don't throw - we want to continue with other governors
      }
    }

    // ==================== SCRAPE_COG_LEADERSHIP ====================
    else if (job.name === 'SCRAPE_COG_LEADERSHIP') {
      console.log('🏛️ Scraping Council of Governors leadership positions...');
      
      // This job updates governor records with their CoG committee roles
      try {
        await page.goto('https://www.cog.go.ke/', {
          waitUntil: 'networkidle2',
          timeout: 60000
        });

        await scraperEngine.waitRandom(2000, 3000);

        // Extract committee leadership (from search results [citation:3][citation:6])
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
          { committee: 'Land, Housing and Urban Development', governor: 'Peter Anyang\' Nyong\'o', county: 'Kisumu' },
          { committee: 'Legal, Constitutional Affairs and Intergovernmental Relations', governor: 'Ochilo Ayacko', county: 'Migori' },
          { committee: 'Security and Foreign Affairs', governor: 'Paul Simba Arati', county: 'Kisii' },
          { committee: 'Tourism and Wildlife', governor: 'Patrick Ole Ntutu', county: 'Narok' },
          { committee: 'Trade and Cooperatives', governor: 'Moses Badilisha Kiarie', county: 'Nyandarua' },
          { committee: 'Transport, Infrastructure and Energy', governor: 'Kimani Wamatangi', county: 'Kiambu' },
          { committee: 'Water and Natural Resources Management', governor: 'Joshua Irungu', county: 'Laikipia' }
        ];

        // Update each governor with their committee role
        for (const leader of committeeLeaders) {
          const result = await Member.findOneAndUpdate(
            { 
              role: 'Governor',
              $or: [
                { county: leader.county },
                { fullName: { $regex: leader.governor, $options: 'i' } }
              ]
            },
            {
              $set: {
                'cogCommittee': {
                  name: leader.committee,
                  role: 'Chairperson'
                }
              }
            },
            { new: true }
          );
          
          if (result) {
            console.log(`   └─ Updated ${leader.governor} as Chair of ${leader.committee}`);
          }
        }

        // Update CoG leadership positions [citation:3][citation:8]
        const cogLeadership = [
          { position: 'Chairperson', governor: 'Ahmed Abdullahi', county: 'Wajir' },
          { position: 'Vice Chairperson', governor: 'Mutahi Kahiga', county: 'Nyeri' },
          { position: 'Chief Whip', governor: 'Muthomi Njuki', county: 'Tharaka Nithi' }
        ];

        for (const leader of cogLeadership) {
          await Member.findOneAndUpdate(
            { 
              role: 'Governor',
              $or: [
                { county: leader.county },
                { fullName: { $regex: leader.governor, $options: 'i' } }
              ]
            },
            {
              $set: {
                'cogPosition': leader.position
              }
            }
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
    console.error('❌ JOB ERROR:', error);
    
    if (page) {
      try {
        await page.screenshot({ path: `error-${job.id}.png` });
        console.log(`📸 Error screenshot saved: error-${job.id}.png`);
      } catch (e) {
        // Ignore
      }
    }
    
    throw error;
  } finally {
    if (page) {
      await page.close().catch(console.error);
    }
  }
}, { 
  connection, 
  concurrency: 2 // Process 2 jobs at once
});

worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} (${job.name}) completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} (${job?.name}) failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('❌ Worker error:', err);
});

console.log('🚀 Worker is active and listening for jobs...');