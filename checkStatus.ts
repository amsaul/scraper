import { scrapeQueue } from './src/services/queue';
import Member from './src/models/members';
import { connectDB } from './src/config/db';

async function checkStatus() {
  await connectDB();

  const active = await scrapeQueue.getJobs(['active']);
  const waiting = await scrapeQueue.getJobs(['waiting']);
  const completed = await scrapeQueue.getJobs(['completed'], 0, 1000);
  const failed = await scrapeQueue.getJobs(['failed'], 0, 1000);

  console.log('=== QUEUE STATUS ===');
  console.log('Active jobs:', active.length);
  console.log('Waiting jobs:', waiting.length);
  console.log('Completed jobs (last 1000):', completed.length);
  console.log('Failed jobs (last 1000):', failed.length);

  const totalMembers = await Member.countDocuments();
  const mpCount = await Member.countDocuments({ role: 'MP' });
  const governorCount = await Member.countDocuments({ role: 'Governor' });

  console.log('\n=== DATABASE STATUS ===');
  console.log('Total members:', totalMembers);
  console.log('MPs:', mpCount);
  console.log('Governors:', governorCount);

  // Expected: 349 MPs (290 constituency + 47 women + 12 nominated) + 47 governors = 396
  console.log('\n=== EXPECTED TOTALS ===');
  console.log('Expected MPs: 349');
  console.log('Expected Governors: 47');
  console.log('Expected Total: 396');

  process.exit(0);
}

checkStatus();