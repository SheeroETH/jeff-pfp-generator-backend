import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Replicate from 'replicate';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Increase limit to accept images if needed, though we use local source now
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Initialize Replicate
const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

// Helper to encode image to base64
function getBase64Image(filePath) {
    const bitmap = fs.readFileSync(filePath);
    return Buffer.from(bitmap).toString('base64');
}

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const MAX_DAILY_GENERATIONS = 50; // Increased limit for testing

const rateLimiter = (req, res, next) => {
    // Get IP address
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const today = new Date().toISOString().split('T')[0];

    const userRecord = rateLimitMap.get(ip);

    if (userRecord && userRecord.date === today) {
        if (userRecord.count >= MAX_DAILY_GENERATIONS) {
            return res.status(429).json({ error: 'Daily limit reached. Please come back tomorrow!' });
        }
        userRecord.count++;
    } else {
        // New user or new day
        rateLimitMap.set(ip, { date: today, count: 1 });
    }

    next();
};

app.post('/api/generate', rateLimiter, async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        console.log('Received generation request for:', prompt);
        console.log('Loading jeff-original.png as reference...');

        // Resolve path to jeff-original.png relative to this file
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const imagePath = path.join(__dirname, 'jeff-original.png');

        if (!fs.existsSync(imagePath)) {
            console.error('Reference image not found at:', imagePath);
            return res.status(500).json({ error: 'Reference image missing on server' });
        }

        // Convert to Data URI for Replicate
        // Replicate expects: "data:image/png;base64,..."
        const base64Image = `data:image/png;base64,${getBase64Image(imagePath)}`;

        console.log('Generating with Google Nano Banana Pro (Gemini)...');

        const model = "google/nano-banana-pro";

        // Using Replicate SDK with stream/wait
        // Input schema correction: 'image' instead of 'image_input', and 'prompt'
        const input = {
            image: base64Image,
            prompt: prompt,
        };

        console.log("Starting prediction...");

        const output = await replicate.run(
            model,
            {
                input: input
            }
        );

        console.log('Generation complete:', output);

        // Handle return (URL or array)
        // Usually returns an array of URIs for image models
        const resultUrl = Array.isArray(output) ? output[0] : output;
        res.json({ result: resultUrl });

    } catch (error) {
        console.error('SERVER ERROR DETAIL:', error);
        res.status(500).json({ error: 'Failed to generate image', details: error.message || error });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
