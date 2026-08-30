require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./config/database');
const { restoreAllJobs } = require('./services/queueService');
const requireEnv = require('./utils/requireEnv');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/platforms', require('./routes/platforms'));
app.use('/api/keywords', require('./routes/keywords'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/analytics', require('./routes/analytics'));  // Analytics routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend for all other routes (SPA fallback)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 8010;

async function startServer() {
  try {
    requireEnv();
    // Connect to MongoDB
    await connectDB();

    // Load worker (starts processing jobs from queue)
    console.log('🔄 Loading scraper worker...');
    require('./workers/scraperWorker');

    // Restore scheduled jobs
    console.log('🔄 Restoring scheduled jobs...');
    await restoreAllJobs();

    // Start listening
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n✅ BuzzHunt server running on http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️  MongoDB: Connected`);
      console.log(`📬 Redis: Connected (job queue active)\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

startServer();
