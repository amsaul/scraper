import Member from './src/models/members';
import { connectDB } from './src/config/db';

/**
 * Identifies potential duplicates by finding members with the same name but different IDs
 * This helps diagnose why counts are higher than expected
 */
async function analyzeAndFixDuplicates() {
  await connectDB();

  try {
    console.log('🔍 Analyzing database for duplicates...\n');

    // Find all members with duplicate names
    const nameDuplicates = await Member.aggregate([
      {
        $group: {
          _id: { $toLower: '$fullName' },
          count: { $sum: 1 },
          roles: { $addToSet: '$role' },
          counties: { $addToSet: '$county' },
          ids: { $push: '$_id' }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 as any } }
    ]);

    console.log(`📊 Found ${nameDuplicates.length} names appearing multiple times\n`);

    // Category 1: Same name, same role, same county (real duplicates)
    const realDuplicates = await Member.aggregate([
      {
        $group: {
          _id: {
            fullName: { $toLower: '$fullName' },
            role: '$role',
            county: { $toLower: '$county' }
          },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);

    console.log(`❌ REAL DUPLICATES (same name, role, county): ${realDuplicates.length}`);
    console.log(`   └─ These should be merged/deleted\n`);

    // Category 2: Same name, same role, different counties (might be ok)
    const roleConflicts = await Member.aggregate([
      {
        $group: {
          _id: {
            fullName: { $toLower: '$fullName' },
            role: '$role'
          },
          count: { $sum: 1 },
          counties: { $addToSet: '$county' }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);

    console.log(`⚠️ ROLE CONFLICTS (same name and role, different counties): ${roleConflicts.length}`);
    for (const conflict of roleConflicts.slice(0, 5)) {
      console.log(`   └─ "${conflict._id.fullName}" (${conflict._id.role}): ${conflict.counties.join(', ')}`);
    }
    console.log();

    // Get current counts
    const totalMembers = await Member.countDocuments();
    const mpCount = await Member.countDocuments({ role: 'MP' });
    const governorCount = await Member.countDocuments({ role: 'Governor' });
    
    // Count unique MPs by name + constituency
    const uniqueMPs = await Member.aggregate([
      { $match: { role: 'MP' } },
      {
        $group: {
          _id: {
            fullName: { $toLower: '$fullName' },
            constituency: { $toLower: '$constituency' }
          }
        }
      },
      { $count: 'unique' }
    ]);

    const uniqueGovernors = await Member.aggregate([
      { $match: { role: 'Governor' } },
      {
        $group: {
          _id: { $toLower: '$fullName' }
        }
      },
      { $count: 'unique' }
    ]);

    console.log(`📊 ===== CURRENT DATABASE STATUS =====`);
    console.log(`Total members: ${totalMembers}`);
    console.log(`MPs: ${mpCount}`);
    console.log(`  └─ Unique MPs (by name+constituency): ${uniqueMPs[0]?.unique || 0}`);
    console.log(`Governors: ${governorCount}`);
    console.log(`  └─ Unique Governors (by name): ${uniqueGovernors[0]?.unique || 0}`);

    console.log(`\n🎯 ===== EXPECTED VALUES =====`);
    console.log(`Expected unique MPs: 349`);
    console.log(`Expected unique Governors: 47`);

    console.log(`\n📈 ===== ANALYSIS =====`);
    console.log(`Duplicate MPs: ${mpCount - (uniqueMPs[0]?.unique || 0)}`);
    console.log(`Duplicate Governors: ${governorCount - (uniqueGovernors[0]?.unique || 0)}`);

    // Show the most duplicated names
    console.log(`\n🔴 ===== TOP 10 MOST DUPLICATED MP NAMES =====`);
    const topDuplicates = await Member.aggregate([
      { $match: { role: 'MP' } },
      {
        $group: {
          _id: { $toLower: '$fullName' },
          count: { $sum: 1 },
          constituencies: { $addToSet: '$constituency' }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    topDuplicates.forEach((dup: any, idx: number) => {
      console.log(`${idx + 1}. "${dup._id}" - ${dup.count} records`);
      console.log(`   Constituencies: ${dup.constituencies.join(', ')}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    process.exit(1);
  }
}

analyzeAndFixDuplicates();
