import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import RunwayML from "@runwayml/sdk";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload size for base64 images
  app.use(express.json({ limit: '50mb' }));

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/clay/scan", async (req, res) => {
    try {
      const { image, useDemo } = req.body; // base64 image data and demo flag
      if (!image) {
        return res.status(400).json({ error: "No image provided" });
      }

      // 1. Check if demo mode is requested or if API keys are missing
      const runwayApiKey = process.env.RUNWAY_API_KEY;
      
      const isRunwayKeyMissing = !runwayApiKey || runwayApiKey === "MY_RUNWAY_API_KEY" || runwayApiKey.startsWith("TODO");

      if (useDemo || isRunwayKeyMissing) {
        console.warn("Using demo fallback (requested or key missing/invalid).");
        return res.json({
          object: "clay creation",
          videoUrl: "https://cdn.runwayml.com/video_previews/gen3_clay_fish_demo.mp4", 
          isDemo: true,
          warning: isRunwayKeyMissing ? "Runway API key is missing or invalid. Please configure it in AI Studio settings." : undefined
        });
      }

      // 2. Generate animation with Runway SDK directly
      console.log("Generating animation with Runway SDK...");
      const runwayClient = new RunwayML({ apiKey: runwayApiKey! });
      
      // Using a descriptive generic prompt since we removed the detection step
      const animationPrompt = "A playful stop-motion clay animation. The clay character in the image comes to life and performs natural movements using its body parts such as legs, arms, wings, tail or fins. The character actively moves through the scene instead of the camera moving. Create a small environment that matches the character naturally. Movement should be lively, expressive and exaggerated like a children's cartoon. Keep the handmade clay texture visible. Bright colorful lighting, cute miniature world, child-friendly style. Stop-motion clay animation style.";

      try {
        const task = await runwayClient.imageToVideo.create({
          model: "gen3a_turbo", 
          promptText: animationPrompt,
          promptImage: image, // Pass the full data URI including the prefix
          duration: 10,
          ratio: "1280:768"
        }) as any;

        console.log("Runway task created:", task.id);

        // 3. Poll for completion
        let currentTask = task;
        let attempts = 0;
        const maxAttempts = 60; // 60 * 5s = 300s (5 mins) max

        while (currentTask.status !== 'SUCCEEDED' && currentTask.status !== 'FAILED' && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          currentTask = await runwayClient.tasks.retrieve(task.id);
          attempts++;
          console.log(`Polling Runway task ${task.id}: ${currentTask.status} (Attempt ${attempts})`);
        }

        if (currentTask.status === 'SUCCEEDED' && currentTask.output && currentTask.output.length > 0) {
          return res.json({
            object: "clay creation",
            videoUrl: currentTask.output[0]
          });
        } else {
          throw new Error(`Runway task failed or timed out: ${currentTask.status}`);
        }

      } catch (runwayError: any) {
        console.error("Runway SDK error:", runwayError);
        
        const errorMsg = runwayError.message || "";
        if (errorMsg.includes("hostname") || errorMsg.includes("401") || errorMsg.includes("key")) {
          return res.json({
            object: "clay creation",
            videoUrl: "https://cdn.runwayml.com/video_previews/gen3_clay_fish_demo.mp4",
            isDemo: true,
            warning: "Runway API key restriction detected. Showing demo instead."
          });
        }
        throw runwayError;
      }

    } catch (error: any) {
      console.error("Error in /api/clay/scan:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
