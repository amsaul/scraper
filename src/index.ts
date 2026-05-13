import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { connectDB } from './config/db';
import Member from './models/members';
import mongoose from 'mongoose';
import { scrapeQueue } from './services/queue';

const app = express();

// Connect Database
connectDB();

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3001', 'http://localhost:3000'], // Your React app URL
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// ==================== API ENDPOINTS ====================

app.get('/', (re,res) => {
  res.json({ message: 'Welcome to the VeriVote API!' });
});


// Health check
app.get('/health', (req, res) => res.status(200).json({ status: 'UP' }));

// Trigger scraper manually
app.get('/api/scrape/trigger', async (req, res) => {
  try {
    const job = await scrapeQueue.add('DISCOVER_MPS', { 
      timestamp: new Date().toISOString(),
      manual: true 
    });

    res.json({ 
      message: 'Scraper triggered successfully!', 
      jobId: job.id 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger scraper' });
  }
});

// ==================== MEMBERS ENDPOINTS ====================

// GET all members with pagination, filtering, and sorting
app.get('/api/members', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      role, 
      county, 
      party,
      search,
      sortBy = 'fullName',
      sortOrder = 'asc'
    } = req.query;

    // Build filter
    const filter: any = {};
    if (role) filter.role = role;
    if (county) filter.county = county;
    if (party) filter.party = party;
    
    // Text search
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { county: { $regex: search, $options: 'i' } },
        { party: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const members = await Member.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean(); // Use lean() for better performance

    // Get total count
    const total = await Member.countDocuments(filter);

    res.json({
      members,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Server Error' });
  }
});

// GET single member by ID
app.get('/api/members/:id', async (req, res) => {
  try {
    const member = await Member.findById(req.params.id).lean();
    
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    res.json(member);
  } catch (error) {
    console.error('Error fetching member:', error);
    res.status(500).json({ error: 'Server Error' });
  }
});

// GET members by party
app.get('/api/members/party/:party', async (req, res) => {
  try {
    const members = await Member.find({ 
      party: { $regex: req.params.party, $options: 'i' } 
    }).limit(100).lean();
    
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// GET members by county
app.get('/api/members/county/:county', async (req, res) => {
  try {
    const members = await Member.find({ 
      county: { $regex: req.params.county, $options: 'i' } 
    }).limit(100).lean();
    
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// GET statistics (for dashboard)
// GET statistics (for dashboard)
app.get('/api/stats', async (req, res) => {
  try {
    const totalMembers = await Member.countDocuments();
    
    const partyStats = await Member.aggregate([
      { $group: { _id: '$party', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 } // Keep limit for parties (there are only ~15 parties)
    ]);
    
    // Get ALL counties (remove the limit)
    const countyStats = await Member.aggregate([
      { $group: { _id: '$county', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
      // No limit here - we want all counties
    ]);
    
    // Get total county count for display
    const totalCounties = countyStats.length;
    
    const recentMembers = await Member.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    res.json({
      totalMembers,
      totalCounties,  // ← Now you can show "47 counties" in your card
      partyStats: partyStats.map(p => ({ party: p._id || 'Unknown', count: p.count })),
      countyStats: countyStats.map(c => ({ county: c._id || 'Unknown', count: c.count })),
      recentMembers
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Server Error' });
  }
});

//GET starting pdf scrapper
app.get('/api/scrape/trigger-pdf', async (req, res) => {
  try {
    const job = await scrapeQueue.add('PROCESS_MP_LIST_PDF', { 
      timestamp: new Date().toISOString(),
      manual: true 
    });
    res.json({ message: 'PDF processing triggered!', jobId: job.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger PDF processing' });
  }
});

// ==================== SEARCH ENDPOINT ====================

// Advanced search
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query required' });
    }

    const members = await Member.find({
      $or: [
        { fullName: { $regex: q, $options: 'i' } },
        { party: { $regex: q, $options: 'i' } },
        { county: { $regex: q, $options: 'i' } }
      ]
    }).limit(50).lean();

    res.json(members);
  } catch (error) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VeriVote API running on port ${PORT}`));