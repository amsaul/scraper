import mongoose from 'mongoose';
import Member from './src/models/members'; // note: no .ts extension needed with tsx
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { resolveCounty } from './src/utils/constituencyCountyMap';

dotenv.config(); // load env variables if needed (e.g., MONGO_URI)

async function exportMembers() {
  try {
    // Use your existing MongoDB connection string (from .env or default)
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/verivote';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Fetch all members (lean() returns plain JS objects); include virtuals
    const members = await Member.find({}).lean({ virtuals: true });

    function computeAge(dob: any): number | null {
      if (!dob) return null;
      const date = new Date(dob);
      if (isNaN(date.getTime())) return null;
      const today = new Date();
      let age = today.getUTCFullYear() - date.getUTCFullYear();
      const m = today.getUTCMonth() - date.getUTCMonth();
      if (m < 0 || (m === 0 && today.getUTCDate() < date.getUTCDate())) {
        age -= 1;
      }
      return age;
    }

    const exportableMembers = members.map((m: any) => {
      const { _id, __v, createdAt, updatedAt, pushStatus, lastPushAttempt, pushError, ...rest } = m;
      // Ensure age is present
      rest.age = computeAge(rest.dateOfBirth);
      // Infer county from constituency if missing
      if ((!rest.county || rest.county === '') && rest.constituency) {
        const inferred = resolveCounty(rest.constituency);
        if (inferred) rest.county = inferred;
      }
      return rest;
    });

    // Write to a JSON file
    await fs.writeFile('members_export.json', JSON.stringify(exportableMembers, null, 2));
    console.log(`✅ Exported ${exportableMembers.length} members to members_export.json`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Export failed:', err);
  }
}

exportMembers();