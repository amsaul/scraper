import Member from './src/models/members';
import { connectDB } from './src/config/db';

/**
 * Clear all members from the database
 * Use with caution - this will delete ALL member records
 */
async function clearDatabase() {
  try {
    await connectDB();
    
    console.log('🔴 WARNING: About to delete ALL members from database');
    console.log('═'.repeat(60));
    
    // Get current counts before deletion
    const beforeCount = await Member.countDocuments();
    console.log(`\n📊 Current database state:`);
    console.log(`   Total members: ${beforeCount}`);
    console.log(`   MPs: ${await Member.countDocuments({ role: 'MP' })}`);
    console.log(`   Governors: ${await Member.countDocuments({ role: 'Governor' })}`);
    
    console.log('\n' + '═'.repeat(60));
    console.log('🗑️ Deleting all members...');
    console.log('═'.repeat(60) + '\n');
    
    // Delete all members
    const result = await Member.deleteMany({});
    
    console.log(`✅ Deleted ${result.deletedCount} records\n`);
    
    // Verify deletion
    const afterCount = await Member.countDocuments();
    console.log(`📊 Database after deletion:`);
    console.log(`   Total members: ${afterCount}`);
    console.log(`   MPs: ${await Member.countDocuments({ role: 'MP' })}`);
    console.log(`   Governors: ${await Member.countDocuments({ role: 'Governor' })}`);
    
    if (afterCount === 0) {
      console.log('\n✅ Database cleared successfully!');
      console.log('🚀 Ready to start fresh scraping\n');
    } else {
      console.log('\n⚠️ WARNING: Some records remain in database\n');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  }
}

// Confirm and execute
console.log('\n🔧 DATABASE CLEAR UTILITY\n');
console.log('This script will DELETE ALL members from your database.');
console.log('You will not be able to recover this data unless you have a backup.\n');

const args = process.argv.slice(2);
if (args.includes('--confirm')) {
  clearDatabase();
} else {
  console.log('To proceed, run with --confirm flag:');
  console.log('  npx tsx clearDatabase.ts --confirm\n');
  console.log('Or use npm script:');
  console.log('  npm run db:clear\n');
  process.exit(0);
}
