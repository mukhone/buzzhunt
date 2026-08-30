# BuzzHunt Setup Guide

Quick start guide for setting up BuzzHunt on Windows 11 Pro or Ubuntu 22.

## Step-by-Step Setup

### 1. MongoDB Setup (5 minutes)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free account
3. Create a new cluster (M0 Free Tier)
4. Wait for cluster to deploy (~5 minutes)
5. Click "Connect" → "Connect your application"
6. Copy the connection string
7. Create a database user with password
8. Whitelist IP: 0.0.0.0/0 (for testing) or your server IP

Your connection string will look like:
```
MONGODB_URI=
```

### 2. Redis Setup

**Windows 11:**
```bash
# Download Redis for Windows from:
# https://github.com/tporadowski/redis/releases

# Extract and run:
redis-server.exe
```

**Ubuntu 22:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

Verify Redis is running:
```bash
redis-cli ping
# Should return: PONG
```

### 3. Gmail App Password Setup (3 minutes)

1. Go to [Google Account](https://myaccount.google.com/)
2. Navigate to Security
3. Enable 2-Step Verification if not already enabled
4. Go to Security → 2-Step Verification → App passwords
5. Select "Mail" and generate password
6. Copy the 16-character password (no spaces)

### 4. Install Dependencies

**Node.js:**
```bash
cd buzzhunt
npm install
```

**Python:**
```bash
cd scrapers
pip install -r requirements.txt
cd ..
```

### 5. Configure Environment Variables

Copy `.env.example` to `.env`:

**Windows:**
```bash
copy .env.example .env
```

**Ubuntu:**
```bash
cp .env.example .env
```

Edit `.env` file with your values:

```env
# Server Configuration
NODE_ENV=production
PORT=8010
FRONTEND_URL=http://localhost:8010

# MongoDB (paste your Atlas connection string)
MONGODB_URI=<mongodb-connection-string>

# JWT Secret (generate random string)
JWT_SECRET=

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Email Configuration
GMAIL_USER=
GMAIL_APP_PASSWORD=

# Scraper Service
SCRAPER_SERVICE_URL=http://localhost:5000
SCRAPER_SERVICE_ENABLED=true

# Scraper Interval Configuration
KEYWORD_SCRAPER_INTERVAL_HOURS=6
PROMPT_SCRAPER_INTERVAL_HOURS=24
```

**Note:** Platform-specific limits (5 keywords for Reddit/Quora, 25 prompts for AI platforms) are configured in `backend/config/database.js`.

### 6. Start the Application

**Terminal 1 - Start Redis** (if not running as service)
```bash
redis-server
```

**Terminal 2 - Start Python Scraper Service**
```bash
cd scrapers
python scraper_service.py
```

**Terminal 3 - Start Node.js Backend**
```bash
npm start
```

You should see:
```
✅ BuzzHunt server running on http://localhost:8010
📊 Environment: production
🗄️  MongoDB: Connected
📬 Redis: Connected (job queue active)
```

### 7. Access the Application

Open your browser and go to:
```
http://localhost:8010
```

## First Time Usage

1. **Create Account**
   - Click "Sign up here"
   - Enter email and password (min 6 characters)
   - You'll be automatically logged in

2. **Add Reddit Platform**
   - Scroll down to "Add New Platform"
   - Click "Add Platform" under Reddit

3. **Add Keywords**
   - Click "Manage Keywords" on the Reddit card
   - Add up to 3 keywords (e.g., "artificial intelligence", "machine learning")
   - Keywords will be monitored every 3 hours

4. **Check Email**
   - When new posts matching your keywords are found, you'll receive an email
   - First scrape will run within 1 minute, then every 3 hours

## Production Deployment

### Windows Service Setup

**Run Backend as Service:**
```bash
# Install PM2 globally
npm install -g pm2

# Start backend
pm2 start backend/server.js --name buzzhunt-backend

# Start scraper service
pm2 start scrapers/scraper_service.py --name buzzhunt-scraper --interpreter python

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Ubuntu Service Setup

**Create systemd service for backend:**

```bash
sudo nano /etc/systemd/system/buzzhunt.service
```

Add:
```ini
[Unit]
Description=BuzzHunt Backend
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/path/to/buzzhunt
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node backend/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**Create systemd service for scraper:**

```bash
sudo nano /etc/systemd/system/buzzhunt-scraper.service
```

Add:
```ini
[Unit]
Description=BuzzHunt Scraper Service
After=network.target

[Service]
Type=simple
User=yourusername
WorkingDirectory=/path/to/buzzhunt/scrapers
ExecStart=/usr/bin/python3 scraper_service.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable buzzhunt
sudo systemctl enable buzzhunt-scraper
sudo systemctl start buzzhunt
sudo systemctl start buzzhunt-scraper
```

## Monitoring

**Check service status:**
```bash
# PM2 (Windows/Ubuntu)
pm2 status
pm2 logs buzzhunt-backend
pm2 logs buzzhunt-scraper

# systemd (Ubuntu)
sudo systemctl status buzzhunt
sudo systemctl status buzzhunt-scraper
sudo journalctl -u buzzhunt -f
```

**Check Redis:**
```bash
redis-cli
> KEYS *
> GET bull:scraper-jobs:*
```

**Check MongoDB:**
- Use MongoDB Compass or Atlas web interface
- Check collections: users, platforms, userplatforms, scraperhistories

## Troubleshooting

### Port Already in Use

**Change backend port:**
Edit `.env`:
```env
PORT=8011
```

**Change scraper port:**
Edit `scrapers/scraper_service.py`:
```python
PORT = int(os.getenv('SCRAPER_PORT', 5001))
```

### Chrome Driver Issues

The scraper will automatically download the correct ChromeDriver version on first run.

If issues persist:
```bash
cd scrapers
pip install --upgrade playwright
playwright install chromium
```

### Email Not Sending

Test Gmail credentials:
```bash
cd backend
node -e "
const nodemailer = require('nodemailer');
require('dotenv').config();
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});
transporter.verify().then(console.log).catch(console.error);
"
```

## Next Steps

- ✅ Add more keywords
- ✅ Monitor multiple platforms
- ✅ Configure keyword and prompt platforms (Reddit, Quora, LinkedIn, Medium, YouTube, Perplexity, ChatGPT, Google AI)

## Support

For issues, check:
1. Server logs: `pm2 logs` or `sudo journalctl -u buzzhunt -f`
2. Redis: `redis-cli ping`
3. MongoDB: Check Atlas monitoring dashboard
4. Browser console for frontend errors
