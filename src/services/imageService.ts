// src/services/imageService.ts
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const IMAGE_STORAGE_DIR = path.join(process.cwd(), 'public', 'images', 'candidates');
// Ensure directory exists
if (!fs.existsSync(IMAGE_STORAGE_DIR)) {
  fs.mkdirSync(IMAGE_STORAGE_DIR, { recursive: true });
}

export async function downloadAndRehostImage(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    const contentType = response.headers['content-type'];
    let extension = '.jpg';
    if (contentType === 'image/png') extension = '.png';
    else if (contentType === 'image/webp') extension = '.webp';

    const fileName = `${uuidv4()}${extension}`;
    const filePath = path.join(IMAGE_STORAGE_DIR, fileName);
    fs.writeFileSync(filePath, response.data);

    // Return the public URL. Adjust this to your domain or CDN.
    const publicUrl = `/images/candidates/${fileName}`;
    return publicUrl;
  } catch (err) {
    console.error(`Failed to download image from ${url}:`, err);
    return null;
  }
}