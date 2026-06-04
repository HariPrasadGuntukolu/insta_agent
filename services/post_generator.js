const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const https = require('https');
const http = require('http');
const url = require('url');

class PostGenerator {
  constructor(configPath) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.width = configData.post_design.width || 1080;
    this.height = configData.post_design.height || 1350;
    this.brandName = configData.post_design.brand_name || "GVN";
    this.brandFullName = configData.post_design.brand_full_name || "GLOBAL VIRAL NEWS";
    this.assetsDir = path.join(__dirname, '../public/assets');

    // Ensure assets directory exists
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
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

  // Fetch relevant image URL from Wikipedia Commons (deep search)
  fetchWikiImage(query) {
    return new Promise((resolve) => {
      const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&generator=search&piprop=original&gsrsearch=${encodeURIComponent(query)}&gsrlimit=10`;
      
      const req = https.get(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.query && data.query.pages) {
              const pages = data.query.pages;
              // Iterate through search results in order and return the first valid non-SVG image
              for (const pageId in pages) {
                const page = pages[pageId];
                if (page.original && page.original.source) {
                  const src = page.original.source;
                  const isSvg = src.toLowerCase().endsWith('.svg');
                  if (!isSvg) {
                    resolve(src);
                    return;
                  }
                }
              }
            }
            resolve(null);
          } catch (e) {
            resolve(null);
          }
        });
      });
      
      req.on('error', () => resolve(null));
      req.setTimeout(4000, () => {
        req.destroy();
        resolve(null);
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

  // Retrieve base64 image data URI for the story
  async getBase64Image(story) {
    const keywords = this.extractKeywords(story.title);
    
    let imageUrl = await this.fetchWikiImage(keywords);
    if (imageUrl) {
      console.log(`[PostGenerator] Found Wiki image for keywords "${keywords}": ${imageUrl}`);
    } else {
      // Fallback to Lorem Flickr: individual tags must be sanitised of spaces and non-alphanumeric chars
      const queryTags = keywords.split(/\s+/)
        .concat(story.category.split(/\s+/))
        .map(t => t.replace(/[^\w]/g, ''))
        .filter(t => t.length > 0)
        .map(t => encodeURIComponent(t))
        .join(',');
      
      imageUrl = `https://loremflickr.com/920/520/${queryTags}`;
      console.log(`[PostGenerator] Using Lorem Flickr image for keywords "${keywords}": ${imageUrl}`);
    }
    
    const tempPath = path.join(__dirname, `../database/temp_${story.id}.jpg`);
    try {
      await this.downloadImage(imageUrl, tempPath);
      const base64Content = fs.readFileSync(tempPath).toString('base64');
      fs.unlinkSync(tempPath); // cleanup
      return `data:image/jpeg;base64,${base64Content}`;
    } catch (err) {
      console.warn(`[PostGenerator] [Warning] Failed to fetch image: ${err.message}. Using gradient fallback.`);
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
      return null;
    }
  }

  // Generate the raw SVG string for a story
  generateSVG(story, base64Image) {
    const theme = this.getCategoryTheme(story.category);
    
    // Wrap headline (approx 25 chars per line, max 3 lines)
    const rawHeadlineLines = this.wrapText(story.title || "", 26).slice(0, 3);
    const headlineLines = rawHeadlineLines.map(line => this.escapeXml(line));
    
    // Wrap supporting text (approx 55 chars per line, max 3 lines)
    const rawContextLines = this.wrapText(story.description || "", 55).slice(0, 3);
    const contextLines = rawContextLines.map(line => this.escapeXml(line));
    
    // Escape brand names, category and source
    const escBrandName = this.escapeXml(this.brandName);
    const escBrandFullName = this.escapeXml(this.brandFullName);
    const escCategory = this.escapeXml(story.category || "General");
    const escSource = this.escapeXml(story.source || "Unknown");
    const escId = this.escapeXml((story.id || "").substring(0, 12).toUpperCase());

    const contextLineHeight = 34;

    return `
    <svg width="${this.width}" height="${this.height}" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Gradient Background -->
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.bgStart}" />
          <stop offset="100%" stop-color="${theme.bgEnd}" />
        </linearGradient>
        
        <!-- Fallback Gradient -->
        <linearGradient id="fallbackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.bgStart}" />
          <stop offset="50%" stop-color="${theme.color}" stop-opacity="0.3" />
          <stop offset="100%" stop-color="${theme.bgEnd}" />
        </linearGradient>

        <!-- Glassmorphism Gradient -->
        <linearGradient id="glassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.07" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.02" />
        </linearGradient>

        <!-- Outer Glow Filter -->
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="12" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id="subtleGlow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <!-- 1. Background Grid -->
      <rect width="1080" height="1350" fill="url(#bgGrad)" />
      
      <!-- Tech Grid Pattern -->
      <g stroke="#ffffff" stroke-opacity="0.01" stroke-width="1">
        <path d="M 0,135 L 1080,135 M 0,270 L 1080,270 M 0,405 L 1080,405 M 0,540 L 1080,540 M 0,675 L 1080,675 M 0,810 L 1080,810 M 0,945 L 1080,945 M 0,1080 L 1080,1080 M 0,1215 L 1080,1215" />
        <path d="M 108,0 L 108,1350 M 216,0 L 216,1350 M 324,0 L 324,1350 M 432,0 L 432,1350 M 540,0 L 540,1350 M 648,0 L 648,1350 M 756,0 L 756,1350 M 864,0 L 864,1350 M 972,0 L 972,1350" />
      </g>

      <!-- Sleek Glowing Borders -->
      <rect x="25" y="25" width="1030" height="1300" fill="none" stroke="${theme.color}" stroke-opacity="0.12" stroke-width="2" rx="16" />
      <rect x="40" y="40" width="1000" height="1270" fill="none" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1" rx="12" />

      <!-- 2. Header: Logo & Identity -->
      <g transform="translate(80, 85)">
        <!-- Brand Initials Icon -->
        <rect width="55" height="55" fill="${theme.color}" fill-opacity="0.1" stroke="${theme.color}" stroke-width="2" rx="8" />
        <text x="27.5" y="37" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="28" font-weight="900" fill="${theme.color}" text-anchor="middle">${escBrandName}</text>
        
        <!-- Brand Name Details -->
        <text x="75" y="26" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="22" font-weight="800" fill="#ffffff" letter-spacing="3">${escBrandFullName}</text>
        <text x="75" y="46" font-family="'Inter', system-ui, sans-serif" font-size="13" font-weight="600" fill="#a0aec0" letter-spacing="2">AUTONOMOUS DIGITAL NETWORK</text>
      </g>

      <!-- Top Right: Verified Badge -->
      <g transform="translate(820, 85)">
        <rect width="180" height="42" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1" rx="21" />
        <circle cx="25" cy="21" r="8" fill="#10B981" />
        <text x="45" y="26" font-family="'Inter', system-ui, sans-serif" font-size="14" font-weight="700" fill="#ffffff" letter-spacing="1">FACT CHECKED</text>
      </g>

      <!-- 3. Category Badge -->
      <g transform="translate(80, 165)">
        <rect width="180" height="36" fill="${theme.color}" fill-opacity="0.15" stroke="${theme.color}" stroke-opacity="0.4" stroke-width="1" rx="6" />
        <text x="90" y="23" font-family="'Inter', system-ui, sans-serif" font-size="13" font-weight="900" fill="${theme.color}" letter-spacing="3" text-anchor="middle">${escCategory.toUpperCase()}</text>
      </g>

      <!-- 4. Headline (Dynamic Lines, Max 3) -->
      <g transform="translate(80, 245)">
        ${headlineLines.map((line, idx) => `
          <text y="${idx * 68}" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="52" font-weight="900" fill="#ffffff" letter-spacing="-0.5">${line}</text>
        `).join('')}
      </g>

      <!-- 5. Central Visual Panel (Relevant Image or Gorgeous Gradient Fallback) -->
      <g transform="translate(80, 470)">
        <clipPath id="imageClip">
          <rect width="920" height="520" rx="16" />
        </clipPath>
        
        ${base64Image ? `
          <!-- Image -->
          <image href="${base64Image}" width="920" height="520" preserveAspectRatio="xMidYMid slice" clip-path="url(#imageClip)" />
        ` : `
          <!-- Fallback Gradient -->
          <rect width="920" height="520" fill="url(#fallbackGrad)" rx="16" />
          <circle cx="460" cy="260" r="110" fill="${theme.color}" fill-opacity="0.03" stroke="${theme.color}" stroke-opacity="0.1" stroke-width="1.5" />
          <text x="460" y="275" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="44" font-weight="900" fill="${theme.color}" fill-opacity="0.5" text-anchor="middle">${escCategory.toUpperCase()}</text>
        `}
        
        <!-- Glowing border around the image container -->
        <rect width="920" height="520" fill="none" stroke="${theme.color}" stroke-opacity="0.25" stroke-width="2" rx="16" />
      </g>

      <!-- 6. Supporting Text / Description -->
      <g transform="translate(80, 1030)">
        ${contextLines.map((line, idx) => `
          <text y="${idx * contextLineHeight}" font-family="'Inter', system-ui, sans-serif" font-size="22" font-weight="500" fill="#cbd5e1" line-height="1.5">${line}</text>
        `).join('')}
      </g>

      <!-- 7. Footer: Brand, Verification, and CTA -->
      <g transform="translate(80, 1235)">
        <line x1="0" y1="-35" x2="920" y2="-35" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.5" />
        
        <text x="0" y="5" font-family="'Inter', system-ui, sans-serif" font-size="14" font-weight="700" fill="#94a3b8" fill-opacity="0.4" letter-spacing="1">ID: ${escId}</text>
        <text x="460" y="5" font-family="'Outfit', 'Inter', system-ui, sans-serif" font-size="15" font-weight="800" fill="${theme.color}" fill-opacity="0.8" letter-spacing="3" text-anchor="middle">AUTONOMOUS GLOBAL MEDIA</text>
        <text x="920" y="5" font-family="'Inter', system-ui, sans-serif" font-size="14" font-weight="700" fill="#94a3b8" fill-opacity="0.4" letter-spacing="1" text-anchor="end">SOURCE: ${escSource.toUpperCase()}</text>
      </g>
    </svg>
    `;
  }

  // Create the image and write files
  async createPost(story) {
    // 1. Fetch relevant image and convert to base64
    const base64Image = await this.getBase64Image(story);
    
    // 2. Generate SVG content
    const svgContent = this.generateSVG(story, base64Image);
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
