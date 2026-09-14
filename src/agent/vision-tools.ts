import { tool } from "langchain";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

export function createVisionTools(apiKey?: string, baseUrl?: string) {
  const visionAnalyze = tool(
    async ({ image_path, question }: { image_path: string; question?: string }) => {
      const resolvedPath = path.resolve(image_path);

      if (!fs.existsSync(resolvedPath)) {
        return `Error: Image file not found at '${resolvedPath}'`;
      }

      try {
        const fileBuffer = fs.readFileSync(resolvedPath);
        const base64Image = fileBuffer.toString("base64");
        const ext = path.extname(resolvedPath).toLowerCase().replace(".", "");
        const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        const dataUrl = `data:${mimeType};base64,${base64Image}`;

        const promptText = question || "Describe this image in detail, listing all key UI elements, text, buttons, and visual anomalies.";

        // Use standard 9router vision-compatible model
        const visionModel = new ChatOpenAI({
          modelName: process.env.VISION_MODEL || process.env.AGENT_MODEL || "gemini-2.0-flash",
          openAIApiKey: apiKey || process.env.OPENAI_API_KEY || "9router-key",
          configuration: {
            baseURL: baseUrl || process.env.OPENAI_BASE_URL || "https://9router.com/v1",
          },
          temperature: 0.1,
        });

        const res = await visionModel.invoke([
          new HumanMessage({
            content: [
              { type: "text", text: promptText },
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
            ],
          }),
        ]);

        return `Vision Analysis Result:\n${res.content}`;
      } catch (e) {
        return `Vision Analysis Failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    {
      name: "vision_analyze",
      description: "Analyze a local image (PNG/JPEG/WebP) or screenshot using multimodal vision model. Can inspect UI elements, read text, or answer specific visual questions.",
      schema: z.object({
        image_path: z.string().describe("Path to local image file (e.g. screenshot PNG)"),
        question: z.string().optional().describe("Specific question or prompt for visual analysis (default: general description)"),
      }),
    }
  );

  return [visionAnalyze];
}
