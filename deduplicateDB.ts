import Member from './src/models/members';
import { connectDB } from './src/config/db';

/**
 * Script to identify and remove duplicate members from the database
 * A member is considered a duplicate if they have the same name, role, and constituency/county
 */
async function deduplicateDB() {
  await connectDB();

  try {
    console.log('🔍 Starting deduplication process...\n');

    // Group members by (fullName, role, county) - these should be unique
    const pipeline = [
      {
        $group: {
          _id: {
            fullName: { $toLower: '$fullName' },
            role: '$role',
            county: { $toLower: '$county' }
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
          members: { $push: '$$ROOT' }
        }
      },
      {
        $match: { count: { $gt: 1 } } // Only groups with duplicates
      },
      {
        $sort: { count: -1 as any } // Sort by count descending
      }
    ];

    const duplicates = await Member.aggregate(pipeline);

    console.log(`📊 Found ${duplicates.length} groups with duplicates\n`);

    let totalDeleted = 0;

    for (const group of duplicates) {
      const { fullName, role, county } = group._id;
      const count = group.count;
      const ids = group.ids as string[];
      const members = group.members;

      console.log(`\n❌ Duplicate Group: "${fullName}" (${role} in ${county})`);
      console.log(`   └─ Found ${count} records:\n`);

      // Sort by lastUpdated to keep the most recent
      const sorted = members.sort((a: any, b: any) => {
        const dateA = new Date(a.lastUpdated || a.createdAt || 0).getTime();
        const dateB = new Date(b.lastUpdated || b.createdAt || 0).getTime();
        return dateB - dateA; // Most recent first
      });

      // Keep the first (most recent), delete the rest
      const keepId = sorted[0]._id;
      const deleteIds = sorted.slice(1).map((m: any) => m._id);

      // Log details
      sorted.forEach((member: any, idx: number) => {
        const isKeeping = member._id.toString() === keepId.toString();
        const status = isKeeping ? '✅ KEEPING' : '🗑️ DELETING';
        const updatedAt = member.lastUpdated || member.createdAt || 'N/A';
        console.log(`   ${status}: ID=${member._id} | Updated: ${updatedAt}`);
        console.log(`           Email: ${member.email || 'N/A'}, Phone: ${member.phone || 'N/A'}`);
      });

      // Delete duplicates
      if (deleteIds.length > 0) {
        const result = await Member.deleteMany({ _id: { $in: deleteIds } });
        totalDeleted += result.deletedCount || 0;
        console.log(`   ✅ Deleted ${result.deletedCount} duplicate(s)`);
      }
    }

    console.log(`\n\n📊 ===== DEDUPLICATION SUMMARY =====`);
    console.log(`Total groups with duplicates: ${duplicates.length}`);
    console.log(`Total records deleted: ${totalDeleted}`);

    // Get final counts
    const totalMembers = await Member.countDocuments();
    const mpCount = await Member.countDocuments({ role: 'MP' });
    const governorCount = await Member.countDocuments({ role: 'Governor' });

    console.log(`\n📈 ===== NEW DATABASE STATUS =====`);
    console.log(`Total members: ${totalMembers}`);
    console.log(`MPs: ${mpCount}`);
    console.log(`Governors: ${governorCount}`);

    console.log(`\n🎯 ===== EXPECTED VALUES =====`);
    console.log(`Expected MPs: 349`);
    console.log(`Expected Governors: 47`);
    console.log(`Expected Total: 396`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during deduplication:', error);
    process.exit(1);
  }
}

deduplicateDB();
