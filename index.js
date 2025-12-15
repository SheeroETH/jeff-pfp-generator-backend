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
const MAX_DAILY_GENERATIONS = 10; // Slightly more generous for testing? Setup as 10.

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

        // Using the same model and logic as reference
        const model = "google/nano-banana-pro";

        // We can use the replicate SDK convenience method if it works well, 
        // but the reference used manual fetch for specific input control. 
        // Let's stick to the SDK if possible for cleaner code, OR stick to reference exactly if reliability is key.
        // The reference used headers and manual fetch. I will rewrite using the SDK for cleaner implementation 
        // UNLESS the reference comment "Manual fetch to ensure control over the input format" implies SDK issues.
        // To be safe and respect the "Manual fetch" comment from the working reference:

        const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                input: {
                    image_input: [base64Image], // Array as per reference requirement
                    prompt: prompt,
                    output_format: "jpg"
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error('SERVER ERROR DETAIL:', error);
            return res.status(response.status).json({ error: 'Failed to generate image', details: error });
        }

        let prediction = await response.json();
        console.log("Prediction created:", prediction.id);

        // Poll for result
        while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
            await new Promise(r => setTimeout(r, 1000));
            const statusRes = await fetch(prediction.urls.get, {
                headers: {
                    "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`,
                }
            });
            prediction = await statusRes.json();
        }

        if (prediction.status !== "succeeded") {
            console.error("Prediction failed:", prediction.error);
            return res.status(500).json({ error: "Prediction failed", details: prediction.error });
        }

        const output = prediction.output;
        console.log('Generation complete:', output);

        // Handle return (URL or array)
        const resultUrl = Array.isArray(output) ? output[0] : output;
        res.json({ result: resultUrl });

    } catch (error) {
        console.error('SERVER ERROR DETAIL:', error);
        res.status(500).json({ error: 'Failed to generate image', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
