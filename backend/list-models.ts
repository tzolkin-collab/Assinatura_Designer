import { GoogleGenAI } from '@google/genai';
import { config } from 'dotenv';
config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function listModels() {
  try {
    const response = await ai.models.list();
    const models = [];
    for await (const page of response) {
      models.push(page);
    }
    console.log(JSON.stringify(models.map(m => m.name), null, 2));
  } catch (e) {
    console.error(e);
  }
}
listModels();