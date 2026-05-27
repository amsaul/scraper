import mongoose from 'mongoose';
import Member from '../src/models/members';
import { parseName } from '../src/utils/nameParser';
import dotenv from 'dotenv';

dotenv.config();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/verivote';

async function fixNames() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find all members that have a fullName but are missing firstName or have honorifics in firstName
  const members = await Member.find({
    fullName: { $exists: true, $ne: null },
    $or: [
      { firstName: { $regex: /^\(?(AMB|DR|ENG|PROF|HON)/i } },
      { firstName: null },
      { lastName: { $regex: /^\(?(AMB|DR|ENG|PROF|HON)/i } }
    ]
  });

  console.log(`Found ${members.length} members to update`);

  let updated = 0;
  for (const member of members) {
    const parsed = parseName(member.fullName);
    if (parsed.firstName !== member.firstName ||
        parsed.middleName !== member.middleName ||
        parsed.lastName !== member.lastName) {
      member.firstName = parsed.firstName;
      member.middleName = parsed.middleName;
      member.lastName = parsed.lastName;
      await member.save();
      updated++;
      console.log(`Updated: ${member.fullName} → ${parsed.firstName} ${parsed.middleName || ''} ${parsed.lastName}`);
    }
  }

  console.log(`✅ Fixed ${updated} members`);
  await mongoose.disconnect();
}

fixNames().catch(console.error);