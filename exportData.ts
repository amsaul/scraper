import mongoose from 'mongoose';
import Member from './src/models/members'; // note: no .ts extension needed with tsx
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config(); // load env variables if needed (e.g., MONGO_URI)

async function exportMembers() {
  try {
    // Use your existing MongoDB connection string (from .env or default)
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/verivote';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Fetch all members (lean() returns plain JS objects)
    const members = await Member.find({}).lean();

    // Write to a JSON file
    await fs.writeFile('members_export.json', JSON.stringify(members, null, 2));
    console.log(`✅ Exported ${members.length} members to members_export.json`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Export failed:', err);
  }
}

exportMembers();