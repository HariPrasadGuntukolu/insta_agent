const fs = require('fs');
const path = require('path');
const http = require('https'); // For live Graph API requests

class Publisher {
  constructor(configPath) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.maxRetries = configData.retry_settings.max_retries || 3;
    this.backoffMs = configData.retry_settings.backoff_factor_ms || 5000;
    this.queueFile = path.join(__dirname, '../database/publishing_queue.json');
    this.postsFile = path.join(__dirname, '../database/generated_posts.json');
  }

  // Load the current publishing queue
  loadQueue() {
    if (!fs.existsSync(this.queueFile)) {
      fs.writeFileSync(this.queueFile, '[]', 'utf8');
    }
    return JSON.parse(fs.readFileSync(this.queueFile, 'utf8'));
  }

  // Save the publishing queue
  saveQueue(queue) {
    fs.writeFileSync(this.queueFile, JSON.stringify(queue, null, 2), 'utf8');
  }

  // Add a post to the queue
  addToQueue(post, scheduledTime, logger = console.log) {
    const queue = this.loadQueue();
    // Check if post already exists in queue
    if (queue.some(item => item.id === post.id)) {
      logger(`[Publisher] Post "${post.title}" is already in the publishing queue.`);
      return;
    }

    queue.push({
      id: post.id,
      title: post.title,
      category: post.category,
      pngPath: post.pngPath,
      caption: post.caption,
      hashtags: post.hashtags,
      scheduledTime: scheduledTime, // ISO string
      status: "scheduled", // "scheduled" | "publishing" | "published" | "failed"
      attempts: 0,
      publishLog: []
    });

    this.saveQueue(queue);
    logger(`[Publisher] Added "${post.title}" to the queue. Scheduled for: ${scheduledTime}`);
  }

  // Publish a specific item from the queue
  async publishItem(queueItem, simulationMode = true, logger = console.log) {
    const queue = this.loadQueue();
    const index = queue.findIndex(item => item.id === queueItem.id);
    if (index === -1) {
      throw new Error(`Item ${queueItem.id} not found in queue.`);
    }

    queue[index].status = "publishing";
    this.saveQueue(queue);

    let attempts = 0;
    let success = false;
    let containerId = null;
    let mediaId = null;

    const fullCaption = `${queueItem.caption}\n\n${queueItem.hashtags}`;

    while (attempts < this.maxRetries && !success) {
      attempts++;
      queue[index].attempts = attempts;
      const logMsg = `Publish attempt ${attempts}/${this.maxRetries} for: "${queueItem.title}"...`;
      logger(`[Publisher] ${logMsg}`);
      queue[index].publishLog.push({ timestamp: new Date().toISOString(), message: logMsg });
      this.saveQueue(queue);

      try {
        if (simulationMode) {
          // Simulate Graph API network latency and behavior
          await this.sleep(2000); // 2 second delay
          
          if (Math.random() < 0.05) {
            // 5% simulated random network failure rate for testing retry behavior
            throw new Error("Simulated Meta API Gateway Timeout (504)");
          }

          containerId = "sim_container_" + Math.floor(Math.random() * 900000000 + 100000000);
          
          // Simulate media creation container checking
          await this.sleep(1000);
          
          mediaId = "sim_media_" + Math.floor(Math.random() * 900000000 + 100000000);
          success = true;
          
          const successMsg = `[Simulation] Published successfully. Media ID: ${mediaId}`;
          logger(`[Publisher] ${successMsg}`);
          queue[index].publishLog.push({ timestamp: new Date().toISOString(), message: successMsg });
        } else {
          // LIVE Instagram Graph API publishing
          const instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
          const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

          if (!instagramAccountId || !instagramAccessToken) {
            throw new Error("Meta credentials missing. Please set INSTAGRAM_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN in .env.");
          }

          // In standard Meta API:
          // Step 1: Upload image to create media container
          // Note: The image must be hosted on a public URL. Since this is running locally,
          // a live publishing requires hosting. If it is local, it will fail unless tunnel is open.
          // We will attempt, but fallback on tunnels or report the direct error.
          logger(`[Publisher] [Live] Creating Instagram media container for ${queueItem.pngPath}...`);
          
          // Construct public URL. Under normal deploys, pngPath is served on the server's public domain.
          // For local testing, we assume a mock/local domain if not set.
          const serverUrl = process.env.SERVER_PUBLIC_URL || "https://yourdomain.com"; 
          const imageUrl = `${serverUrl}${queueItem.pngPath}`;

          containerId = await this.createInstagramMediaContainer(instagramAccountId, instagramAccessToken, imageUrl, fullCaption);
          logger(`[Publisher] [Live] Media container created: ${containerId}. Waiting for processing...`);
          
          // Step 2: Poll container status
          await this.pollContainerStatus(instagramAccountId, instagramAccessToken, containerId, logger);

          // Step 3: Publish container
          logger(`[Publisher] [Live] Publishing container ${containerId}...`);
          mediaId = await this.publishInstagramContainer(instagramAccountId, instagramAccessToken, containerId);
          success = true;

          const successMsg = `[Live] Published successfully. Media ID: ${mediaId}`;
          logger(`[Publisher] ${successMsg}`);
          queue[index].publishLog.push({ timestamp: new Date().toISOString(), message: successMsg });
        }
      } catch (error) {
        const errorMsg = `Attempt ${attempts} failed: ${error.message}`;
        logger(`[Publisher] [Error] ${errorMsg}`);
        queue[index].publishLog.push({ timestamp: new Date().toISOString(), message: errorMsg });
        this.saveQueue(queue);

        if (attempts < this.maxRetries) {
          const waitTime = this.backoffMs * Math.pow(2, attempts - 1);
          logger(`[Publisher] Waiting ${waitTime / 1000}s before retrying...`);
          await this.sleep(waitTime);
        }
      }
    }

    if (success) {
      queue[index].status = "published";
      queue[index].mediaId = mediaId;
      queue[index].publishedAt = new Date().toISOString();
      this.saveQueue(queue);

      // Also update main generated posts database to keep statuses aligned
      this.updatePostStatus(queueItem.id, "published", mediaId);
      return mediaId;
    } else {
      queue[index].status = "failed";
      this.saveQueue(queue);
      this.updatePostStatus(queueItem.id, "failed");
      throw new Error(`Failed to publish story "${queueItem.title}" after ${this.maxRetries} attempts.`);
    }
  }

  // Update post status in generated_posts.json
  updatePostStatus(postId, status, mediaId = null) {
    if (fs.existsSync(this.postsFile)) {
      const posts = JSON.parse(fs.readFileSync(this.postsFile, 'utf8'));
      const postIndex = posts.findIndex(p => p.id === postId);
      if (postIndex !== -1) {
        posts[postIndex].status = status;
        if (mediaId) posts[postIndex].mediaId = mediaId;
        fs.writeFileSync(this.postsFile, JSON.stringify(posts, null, 2), 'utf8');
      }
    }
  }

  // Sleep utility
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper: Create media container via Instagram Graph API
  createInstagramMediaContainer(accountId, token, imageUrl, caption) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        image_url: imageUrl,
        caption: caption
      });

      const options = {
        hostname: 'graph.facebook.com',
        path: `/v17.0/${accountId}/media?access_token=${token}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.id) {
              resolve(data.id);
            } else {
              reject(new Error(data.error ? data.error.message : "Failed to create media container"));
            }
          } catch (e) {
            reject(new Error("Invalid response format from Meta API"));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.write(postData);
      req.end();
    });
  }

  // Helper: Poll status of media container
  async pollContainerStatus(accountId, token, containerId, logger) {
    let finished = false;
    let attempts = 0;
    while (!finished && attempts < 10) {
      attempts++;
      await this.sleep(3000); // Wait 3s before checking

      const status = await new Promise((resolve, reject) => {
        http.get(`https://graph.facebook.com/v17.0/${containerId}?fields=status_code&access_token=${token}`, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve(data.status_code || "UNKNOWN");
            } catch (e) {
              resolve("UNKNOWN");
            }
          });
        }).on('error', e => resolve("ERROR"));
      });

      logger(`[Publisher] Container status check ${attempts}: ${status}`);

      if (status === "FINISHED") {
        finished = true;
      } else if (status === "ERROR") {
        throw new Error("Container creation failed during processing");
      }
    }
  }

  // Helper: Publish container via Instagram Graph API
  publishInstagramContainer(accountId, token, containerId) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        creation_id: containerId
      });

      const options = {
        hostname: 'graph.facebook.com',
        path: `/v17.0/${accountId}/media_publish?access_token=${token}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.id) {
              resolve(data.id);
            } else {
              reject(new Error(data.error ? data.error.message : "Failed to publish media container"));
            }
          } catch (e) {
            reject(new Error("Invalid response format from Meta API"));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.write(postData);
      req.end();
    });
  }
}

module.exports = Publisher;
