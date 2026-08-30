const nodemailer = require('nodemailer');

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // use SSL
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  },
  tls: {
    // Handle self-signed certificates and SSL issues
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'
  }
});

// Send alert email with new results
// Returns true if email was sent successfully, false if skipped/failed
async function sendAlertEmail(toEmail, platformName, keywords, results) {
  if (!process.env.GMAIL_APP_PASSWORD) {
    console.warn('⚠️  GMAIL_APP_PASSWORD not set - skipping email');
    return false; // BUGFIX: Return false so worker knows email wasn't sent
  }

  try {
    // Use "sources" for prompt-based AI platforms, "posts" for keyword-based social platforms
    const contentType = (platformName.includes('Perplexity') || platformName.includes('ChatGPT') || platformName.includes('Google AI')) ? 'sources' : 'posts';
    const subject = `[BuzzHunt] ${results.length} new ${platformName} ${contentType} for ${keywords.join(', ')}`;

    const html = generateEmailHTML(toEmail, platformName, keywords, results);

    await transporter.sendMail({
      from: `"BuzzHunt" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: subject,
      html: html
    });

    console.log(`📧 Email sent to ${toEmail} (${results.length} posts)`);
    return true; // Successfully sent
  } catch (error) {
    console.error('Error sending email:', error);
    return false; // BUGFIX: Return false instead of throwing, so worker can continue
  }
}

// Generate HTML email content
function generateEmailHTML(toEmail, platformName, keywords, results) {
  // Determine if this is a prompt-based platform (Perplexity, ChatGPT, Google AI)
  const isPromptBased = platformName.includes('Perplexity') || platformName.includes('ChatGPT') || platformName.includes('Google AI');
  const contentType = isPromptBased ? 'sources' : 'posts';
  const inputType = isPromptBased ? 'prompts' : 'keywords';

  const formatRow = (result) => {
    const age = result.age ? ` <span style='color:gray'>[${result.age}]</span>` : '';
    const resultKeywords = result.keywords && result.keywords.length > 0
      ? result.keywords.join(', ')
      : keywords.join(', ');

    // Extract domain name from URL if title is missing
    let displayTitle = result.title || '';
    if (!displayTitle || displayTitle.trim() === '') {
      try {
        const url = new URL(result.url);
        displayTitle = url.hostname.replace('www.', '');
      } catch (e) {
        displayTitle = result.url;
      }
    }

    return `<li style="margin-bottom: 8px;"><a href="${result.url}" style="color: #1976d2; text-decoration: none;">${displayTitle}</a>${age} <span style="color: #666; font-size: 13px;">(${resultKeywords})</span></li>`;
  };

  const htmlRows = results.map(formatRow).join('\n');

  // Extract domain summary (only for prompt-based platforms)
  let domainSummary = '';
  if (isPromptBased) {
    const domainCount = {};
    results.forEach(result => {
      try {
        const url = new URL(result.url);
        const domain = url.hostname.replace('www.', '');
        domainCount[domain] = (domainCount[domain] || 0) + 1;
      } catch (e) {
        // Skip invalid URLs
      }
    });

    // Sort domains by count (descending)
    if (Object.keys(domainCount).length > 0) {
      domainSummary = Object.entries(domainCount)
        .sort((a, b) => b[1] - a[1])
        .map(([domain, count]) => `<span style="display: inline-block; background-color: #e3f2fd; padding: 4px 10px; margin: 4px; border-radius: 12px; font-size: 13px;"><strong>${domain}</strong> (${count})</span>`)
        .join('');
    }
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h2 style="color: #1976d2; margin-top: 0;">🔔 New ${platformName} ${contentType.charAt(0).toUpperCase() + contentType.slice(1)} Found!</h2>

        <p>Hi ${toEmail},</p>

        <p>Here are the latest <strong>${platformName}</strong> ${contentType} matching your ${inputType}: <strong>${keywords.join(', ')}</strong></p>

        ${domainSummary ? `
        <div style="background-color: white; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; font-size: 16px; color: #555;">📊 Sources by Domain:</h3>
          <div style="line-height: 2;">
            ${domainSummary}
          </div>
        </div>
        ` : ''}

        <div style="background-color: white; padding: 15px; border-radius: 5px;">
          <h3 style="margin-top: 0; font-size: 16px; color: #555;">🔗 All ${contentType.charAt(0).toUpperCase() + contentType.slice(1)} (${results.length}):</h3>
          <ul style="list-style-position: inside; padding-left: 0;">
            ${htmlRows}
          </ul>
        </div>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

        <div style="text-align: center; color: #666; font-size: 14px;">
          <a href="https://mukh.one" style="color: inherit; text-decoration: none; display: inline-block;">
            <img src="https://mukh.one/assets/mukh1.png" alt="Mukh.1" style="height: 24px; vertical-align: middle; margin-right: 7px;">
            <strong>Powered by Mukh.1</strong>
          </a>
          <br>
          <span style="margin-top: 10px; display: block;">
            BuzzHunt brings you fresh ${contentType}, powered by
            <a href="https://mukh.one" style="color: #1976d2; text-decoration: underline;">Mukh.1</a>
          </span>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Send welcome email to new users
async function sendWelcomeEmail(toEmail) {
  if (!process.env.GMAIL_APP_PASSWORD) {
    return;
  }

  try {
    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
          <h2 style="color: #1976d2;">Welcome to BuzzHunt! 🎉</h2>

          <p>Hi ${toEmail},</p>

          <p>Thank you for signing up for BuzzHunt! Your account has been created successfully.</p>

          <p><strong>What's next?</strong></p>
          <ol>
            <li>Add platforms you want to monitor (Reddit, Quora, etc.)</li>
            <li>Set up keywords for each platform</li>
            <li>We'll email you when new posts matching your keywords are found!</li>
          </ol>

          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

          <div style="text-align: center; color: #666; font-size: 14px;">
            <p>Questions? Just reply to this email.</p>
            <a href="https://mukh.one" style="color: #1976d2;">Powered by Mukh.1</a>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"BuzzHunt" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: 'Welcome to BuzzHunt!',
      html: html
    });

    console.log(`📧 Welcome email sent to ${toEmail}`);
  } catch (error) {
    console.error('Error sending welcome email:', error);
  }
}

module.exports = {
  sendAlertEmail,
  sendWelcomeEmail
};
