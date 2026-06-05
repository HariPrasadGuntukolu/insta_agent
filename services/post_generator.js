const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const https = require('https');
const http = require('http');
const url = require('url');

// Disable sharp cache to prevent OOM (Out Of Memory) in memory-constrained environments like Render Free Tier (512MB RAM)
sharp.cache(false);

class PostGenerator {
  constructor(configPath) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.width = 1080;
    this.height = 1080;
    this.brandName = configData.post_design.brand_name || "GVN";
    this.brandFullName = configData.post_design.brand_full_name || "GLOBAL VIRAL NEWS";
    this.assetsDir = path.join(__dirname, '../public/assets');

    // Ensure assets directory exists
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }

    // Load logo file as base64
    const logoPath = path.join(this.assetsDir, 'logo.png');
    if (fs.existsSync(logoPath)) {
      this.logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
    } else {
      this.logoBase64 = null;
    }
  }

  // Get color configuration based on category
  getCategoryTheme(category) {
    const themes = {
      "Technology": {
        color: "#00f0ff", // Glowing cyan
        gradient: "linear-gradient(135deg, #005f73 0%, #0a1128 100%)",
        bgStart: "#0a192f",
        bgEnd: "#020c1b",
        glowColor: "#00f0ff"
      },
      "Business": {
        color: "#00ff87", // Emerald green
        gradient: "linear-gradient(135deg, #0b3c2e 0%, #051410 100%)",
        bgStart: "#051f16",
        bgEnd: "#020c09",
        glowColor: "#00ff87"
      },
      "World Affairs": {
        color: "#ffc837", // Bright gold
        gradient: "linear-gradient(135deg, #513600 0%, #150f00 100%)",
        bgStart: "#221800",
        bgEnd: "#0d0900",
        glowColor: "#ffc837"
      },
      "Science": {
        color: "#9b5de5", // Electric purple
        gradient: "linear-gradient(135deg, #2a004f 0%, #0a001a 100%)",
        bgStart: "#1c0035",
        bgEnd: "#0a0015",
        glowColor: "#9b5de5"
      },
      "Entertainment": {
        color: "#ff007f", // Neon pink
        gradient: "linear-gradient(135deg, #4f002a 0%, #1a000a 100%)",
        bgStart: "#30001a",
        bgEnd: "#10000a",
        glowColor: "#ff007f"
      },
      "Sports": {
        color: "#ff4757", // High contrast coral red
        gradient: "linear-gradient(135deg, #4f0a0a 0%, #150202 100%)",
        bgStart: "#2d0505",
        bgEnd: "#0f0101",
        glowColor: "#ff4757"
      },
      "Viral Internet": {
        color: "#ccff00", // Lime neon yellow
        gradient: "linear-gradient(135deg, #3a4700 0%, #0e1100 100%)",
        bgStart: "#1b2000",
        bgEnd: "#0a0c00",
        glowColor: "#ccff00"
      }
    };
    return themes[category] || themes["Viral Internet"];
  }

  // Wrap text into multiple lines of max character length
  wrapText(text = "", maxChars = 28) {
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = "";

    for (const word of words) {
      const candidateLine = currentLine ? `${currentLine} ${word}` : word;
      if (candidateLine.length <= maxChars) {
        currentLine = candidateLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  // Escape special XML characters to prevent parsing issues and XML injection
  escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return "";
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  // Extract clean keywords from the title
  extractKeywords(title = "") {
    const cleanTitle = title.replace(/[^\w\s]/gi, '');
    const words = cleanTitle.split(/\s+/).filter(w => w.length > 0);
    
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'at', 'from', 'by', 'about', 'to', 'in', 'on', 'of',
      'is', 'are', 'was', 'were', 'has', 'have', 'had', 'be', 'been', 'being', 'am', 'it', 'its', 'they', 'them',
      'announces', 'announcement', 'reveals', 'unveils', 'launches', 'completes', 'crosses', 'reaches', 'decided', 'becomes'
    ]);
    
    const filtered = words.filter(word => !stopWords.has(word.toLowerCase()));
    if (filtered.length === 0) return "news";
    return filtered.slice(0, 3).join(' ');
  }

  // Fetch up to limit relevant image URLs from Wikipedia Commons (deep search)
  fetchWikiImages(query, limit = 3) {
    return new Promise((resolve) => {
      const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&generator=search&piprop=original&gsrsearch=${encodeURIComponent(query)}&gsrlimit=15`;
      
      const req = https.get(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const imageUrls = [];
            if (data.query && data.query.pages) {
              const pages = data.query.pages;
              for (const pageId in pages) {
                const page = pages[pageId];
                if (page.original && page.original.source) {
                  const src = page.original.source;
                  const isSvg = src.toLowerCase().endsWith('.svg');
                  if (!isSvg && !imageUrls.includes(src)) {
                    imageUrls.push(src);
                    if (imageUrls.length >= limit) break;
                  }
                }
              }
            }
            resolve(imageUrls);
          } catch (e) {
            resolve([]);
          }
        });
      });
      
      req.on('error', () => resolve([]));
      req.setTimeout(4000, () => {
        req.destroy();
        resolve([]);
      });
    });
  }

  // Download image file to destination following redirects
  downloadImage(urlStr, dest) {
    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(urlStr);
      const client = urlStr.startsWith('https') ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.path || parsedUrl.pathname + (parsedUrl.search || ''),
        port: parsedUrl.port,
        headers: {
          'User-Agent': 'GlobalViralNewsAgent/1.0 (contact@globalviralnews.com)'
        }
      };

      const req = client.get(options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          let redirectUrl = res.headers.location;
          if (!redirectUrl.startsWith('http')) {
            redirectUrl = url.resolve(urlStr, redirectUrl);
          }
          this.downloadImage(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Failed with status ${res.statusCode} at ${urlStr}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(dest);
        });
      });

      req.on('error', reject);
      req.setTimeout(6000, () => {
        req.destroy();
        reject(new Error("Image download timeout"));
      });
    });
  }

  // Intelligently evaluate multiple images and select the single best one
  evaluateAndSelectImage(imageUrls, keywords) {
    if (imageUrls.length === 0) return null;
    if (imageUrls.length === 1) return imageUrls[0];
    
    let bestUrl = imageUrls[0];
    let maxScore = -1;
    const keywordArr = keywords.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    for (const urlStr of imageUrls) {
      let score = 0;
      const urlLower = urlStr.toLowerCase();
      
      // Match keywords in URL filename
      for (const keyword of keywordArr) {
        if (urlLower.includes(keyword)) {
          score += 2;
        }
      }
      
      // Prefer standard photo extensions (JPEGs) over PNG graphics/logos
      if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) {
        score += 1;
      }
      
      if (score > maxScore) {
        maxScore = score;
        bestUrl = urlStr;
      }
    }
    
    return bestUrl;
  }

  // Retrieve base64 image data URI for the single hero image
  async getBase64Images(story) {
    const keywords = this.extractKeywords(story.title);
    let imageUrls = await this.fetchWikiImages(keywords, 3);
    
    if (imageUrls.length === 0) {
      imageUrls = await this.fetchWikiImages(story.category, 2);
    }
    
    // STRICT REQUIREMENT: No generic stock photos, unrelated visuals or Lorem Flickr placeholders
    if (imageUrls.length === 0) {
      console.log(`[PostGenerator] No relevant Wikipedia images found for "${keywords}". Falling back to typography-driven news card.`);
      return [];
    }

    // Intelligently evaluate and select the single best image representation
    const selectedUrl = this.evaluateAndSelectImage(imageUrls, keywords);
    console.log(`[PostGenerator] Selected single hero image for "${keywords}": ${selectedUrl}`);

    const tempPath = path.join(__dirname, `../database/temp_${story.id}_0.jpg`);
    try {
      await this.downloadImage(selectedUrl, tempPath);
      
      // Resize to fixed hero dimensions: 960x420
      const resizedBuffer = await sharp(tempPath)
        .resize(960, 420, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer();
        
      fs.unlinkSync(tempPath); // cleanup
      return [`data:image/jpeg;base64,${resizedBuffer.toString('base64')}`];
    } catch (err) {
      console.warn(`[PostGenerator] [Warning] Failed to fetch image (${selectedUrl}): ${err.message}`);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
      return [];
    }
  }

  // Generate the raw SVG string for a story
  generateSVG(story, base64Images = []) {
    const theme = this.getCategoryTheme(story.category);
    
    // Wrap headline (approx 30 chars per line, max 3 lines)
    const rawHeadlineLines = this.wrapText(story.title || "", 30).slice(0, 3);
    const headlineLines = rawHeadlineLines.map(line => this.escapeXml(line));
    
    // Escape brand names, category and source
    const escBrandFullName = this.escapeXml(this.brandFullName);
    const escCategory = this.escapeXml(story.category || "General");
    const escSource = this.escapeXml(story.source || "Unknown");

    const headlineFontSize = 38;
    const headlineLineHeight = 48;

    const imagePresent = base64Images && base64Images.length > 0;
    const imageHeight = 420;

    // Fixed layout grid Y coordinates (1080x1080)
    const yHeadline = 160;
    const yImage = 300;
    const ySummary = 750;

    // Wrap news summary / description and dynamically adjust size to fit Y=750 to Y=950 (200px limit)
    let summaryFontSize = 18;
    let summaryLineHeight = 28;
    let summaryMaxChars = 75;
    let rawSummaryLines = [];
    let summaryLines = [];

    if (imagePresent) {
      // Find the largest font size (up to 19) that fits in the 200px vertical space
      for (const fsSize of [19, 18, 17, 16, 15, 14]) {
        summaryFontSize = fsSize;
        summaryLineHeight = fsSize + 10;
        summaryMaxChars = fsSize === 19 ? 72 : (fsSize === 18 ? 75 : (fsSize === 17 ? 80 : (fsSize === 16 ? 85 : 90)));
        rawSummaryLines = this.wrapText(story.description || "", summaryMaxChars);
        const tempHeight = rawSummaryLines.length * summaryLineHeight;
        if (tempHeight <= 200) {
          break;
        }
      }
      summaryLines = rawSummaryLines.map(line => this.escapeXml(line));
    } else {
      // Fallback layout card sizing inside the same Y=300 to Y=720 card
      let fallbackFontSize = 23;
      let fallbackLineHeight = 35;
      let fallbackMaxChars = 60;
      
      for (const fsSize of [25, 24, 23, 22, 20, 18]) {
        fallbackFontSize = fsSize;
        fallbackLineHeight = fsSize + 12;
        fallbackMaxChars = fsSize === 25 ? 56 : (fsSize === 24 ? 58 : 60);
        rawSummaryLines = this.wrapText(story.description || "", fallbackMaxChars);
        const tempHeight = rawSummaryLines.length * fallbackLineHeight;
        if (tempHeight <= 320) { // Fits inside the 420px height card with padding
          break;
        }
      }
      summaryLines = rawSummaryLines.map(line => this.escapeXml(line));
      summaryFontSize = fallbackFontSize;
      summaryLineHeight = fallbackLineHeight;
    }

    // Formulate SVG Collage / Fallback section
    let imageSection = "";
    if (imagePresent) {
      imageSection = `
        <!-- Single Hero Image -->
        <image href="${base64Images[0]}" x="60" y="${yImage}" width="960" height="${imageHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#imageClip)" />
        <rect x="60" y="${yImage}" width="960" height="${imageHeight}" fill="none" stroke="${theme.color}" stroke-opacity="0.25" stroke-width="1.5" rx="16" />
      `;
    } else {
      // Premium typography-focused layout fallback card when no relevant image is found
      imageSection = `
        <!-- Typography Glassmorphic Card -->
        <rect x="60" y="${yImage}" width="960" height="${imageHeight}" fill="url(#glassGrad)" stroke="${theme.color}" stroke-opacity="0.2" stroke-width="1.5" rx="20" />
        
        <!-- Large Quote Icon -->
        <text x="100" y="${yImage + 100}" font-family="'Outfit', system-ui, sans-serif" font-size="120" font-weight="900" fill="${theme.color}" fill-opacity="0.12">“</text>
        
        <!-- Center align summary contents inside card -->
        <g transform="translate(110, ${yImage + 130})">
          ${summaryLines.map((line, idx) => `
            <text y="${idx * summaryLineHeight}" font-family="'Inter', system-ui, sans-serif" font-size="${summaryFontSize}" font-weight="500" fill="#e2e8f0" line-height="1.6">${line}</text>
          `).join('')}
        </g>
      `;
    }

    return `
    <svg width="${this.width}" height="${this.height}" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Style for fonts -->
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Outfit:wght@800;900&amp;display=swap');
        </style>

        <!-- Gradient Background -->
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.bgStart}" />
          <stop offset="100%" stop-color="${theme.bgEnd}" />
        </linearGradient>
        
        <!-- Glassmorphism Gradient -->
        <linearGradient id="glassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.06" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.01" />
        </linearGradient>

        <!-- Clipping paths for single hero image -->
        <clipPath id="imageClip">
          <rect x="60" y="${yImage}" width="960" height="${imageHeight}" rx="16" />
        </clipPath>
      </defs>

      <!-- 1. Background Grid -->
      <rect width="1080" height="1080" fill="url(#bgGrad)" />
      
      <!-- Tech Grid Pattern -->
      <g stroke="#ffffff" stroke-opacity="0.01" stroke-width="1">
        <path d="M 0,108 L 1080,108 M 0,216 L 1080,216 M 0,324 L 1080,324 M 0,432 L 1080,432 M 0,540 L 1080,540 M 0,648 L 1080,648 M 0,756 L 1080,756 M 0,864 L 1080,864 M 0,972 L 1080,972" />
        <path d="M 108,0 L 108,1080 M 216,0 L 216,1080 M 324,0 L 324,1080 M 432,0 L 432,1080 M 540,0 L 540,1080 M 648,0 L 648,1080 M 756,0 L 756,1080 M 864,0 L 864,1080 M 972,0 L 972,1080" />
      </g>

      <!-- Sleek Glowing Borders -->
      <rect x="25" y="25" width="1030" height="1030" fill="none" stroke="${theme.color}" stroke-opacity="0.12" stroke-width="2" rx="16" />
      <rect x="40" y="40" width="1000" height="1000" fill="none" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1" rx="12" />

      <!-- 2. Header: Logo & Identity (Optimized for space, removed subtitle) -->
      <g transform="translate(60, 60)">
        ${this.logoBase64 ? `
          <!-- User Logo Image -->
          <image href="${this.logoBase64}" x="0" y="0" width="55" height="55" />
        ` : `
          <!-- Fallback Logo Icon -->
          <rect width="55" height="55" fill="${theme.color}" fill-opacity="0.1" stroke="${theme.color}" stroke-width="2" rx="8" />
          <text x="27.5" y="37" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="28" font-weight="900" fill="${theme.color}" text-anchor="middle">${this.escapeXml(this.brandName)}</text>
        `}
        
        <!-- Brand Name Details -->
        <text x="75" y="36" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="24" font-weight="900" fill="#ffffff" letter-spacing="1.5">${escBrandFullName}</text>
      </g>

      <!-- Top Right: Category Badge -->
      <g transform="translate(860, 70)">
        <rect width="160" height="34" fill="${theme.color}" fill-opacity="0.12" stroke="${theme.color}" stroke-opacity="0.3" stroke-width="1" rx="8" />
        <text x="80" y="21" font-family="'Inter', system-ui, sans-serif" font-size="11" font-weight="900" fill="${theme.color}" letter-spacing="2.5" text-anchor="middle">${escCategory.toUpperCase()}</text>
      </g>

      <!-- 3. Headline (Fixed Start Y=160, Max 3 Lines) -->
      <g transform="translate(60, ${yHeadline})">
        ${headlineLines.map((line, idx) => `
          <text y="${idx * headlineLineHeight}" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="${headlineFontSize}" font-weight="900" fill="#ffffff" letter-spacing="-0.5">${line}</text>
        `).join('')}
      </g>

      <!-- 4. Hero Visual Panel -->
      ${imageSection}

      <!-- 5. Supporting Text / News Summary (Rendered below single image if present) -->
      ${imagePresent ? `
        <g transform="translate(60, ${ySummary})">
          ${summaryLines.map((line, idx) => `
            <text y="${idx * summaryLineHeight}" font-family="'Inter', system-ui, sans-serif" font-size="${summaryFontSize}" font-weight="500" fill="#cbd5e1" line-height="1.5">${line}</text>
          `).join('')}
        </g>
      ` : ''}

      <!-- 6. Footer: Attribution only (Clean space optimized, no ID or daily update labels) -->
      <g transform="translate(60, 1010)">
        <line x1="0" y1="-30" x2="960" y2="-30" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.5" />
        <text x="960" y="5" font-family="'Inter', system-ui, sans-serif" font-size="12" font-weight="700" fill="#64748b" letter-spacing="1.5" text-anchor="end">SOURCE: ${escSource.toUpperCase()}</text>
      </g>
    </svg>
    `;
  }

  // Create the image and write files
  async createPost(story) {
    // 1. Fetch relevant images as an array containing the single selected hero image
    const base64Images = await this.getBase64Images(story);
    
    // 2. Generate SVG content
    const svgContent = this.generateSVG(story, base64Images);
    const svgPath = path.join(this.assetsDir, `post_${story.id}.svg`);
    const pngPath = path.join(this.assetsDir, `post_${story.id}.png`);

    // 3. Write the SVG file (useful for rendering directly on the dashboard)
    fs.writeFileSync(svgPath, svgContent, 'utf8');

    // 4. Convert to PNG using sharp (crisp and high performance)
    const svgBuffer = Buffer.from(svgContent);
    await sharp(svgBuffer)
      .png({ quality: 100 })
      .toFile(pngPath);

    return {
      svgPath: `/assets/post_${story.id}.svg`,
      pngPath: `/assets/post_${story.id}.png`
    };
  }
}

module.exports = PostGenerator;
