
import { GoogleGenAI, Type, Schema, Chat } from "@google/genai";
import { LearningPillar, LessonPath, Curriculum, ChatMessage } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_NAME = 'gemini-2.5-flash';

// Helper to clean JSON string if the model adds markdown blocks
const cleanJson = (text: string): string => {
  return text.replace(/```json\n?|\n?```/g, '').trim();
};

export const generatePillars = async (subject: string): Promise<LearningPillar[]> => {
  const prompt = `
    Act as an expert curriculum designer. 
    Break down the subject "${subject}" into exactly 30 distinct, high-level "Learning Pillars" or key topic areas.
    These should cover the subject from beginner to advanced mastery.
    For each pillar, select one icon category from: 
    "tech" (coding, computers), "science" (chemistry, physics), "art" (design, creative), 
    "business" (finance, management), "history" (past events), "health" (medicine, fitness), 
    "math" (numbers, stats), "law" (legal, politics), "language" (speech, writing), 
    "philosophy" (thinking, mind), "social" (people, culture), "nature" (plants, env), 
    "music" (audio), "data" (databases, charts). 
    Use "general" if none fit perfectly.
    Return ONLY a JSON array of objects.
  `;

  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.INTEGER },
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        icon: { type: Type.STRING, enum: ["tech", "science", "art", "business", "history", "health", "math", "law", "language", "philosophy", "social", "nature", "music", "data", "general"] },
      },
      required: ["id", "title", "description", "icon"],
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: "You are a structural learning architect. You output strict JSON."
      },
    });

    const text = response.text || "[]";
    const data = JSON.parse(cleanJson(text));
    
    // Assign incremental IDs if not present or messy
    return data.map((item: any, index: number) => ({
      ...item,
      id: index + 1
    }));
  } catch (error) {
    console.error("Error generating pillars:", error);
    throw new Error("Failed to generate learning pillars. Please try again.");
  }
};

export const generateLessonPaths = async (subject: string, pillar: string): Promise<LessonPath[]> => {
  const prompt = `
    For the subject "${subject}" and the specific pillar "${pillar}", 
    generate exactly 10 specific "Lesson Paths". 
    Each path should be a focused module or course that a student could take.
    Include difficulty levels.
    Return ONLY a JSON array.
  `;

  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.INTEGER },
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        difficulty: { type: Type.STRING, enum: ["Beginner", "Intermediate", "Advanced"] },
        estimatedTime: { type: Type.STRING },
      },
      required: ["id", "title", "description", "difficulty", "estimatedTime"],
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const text = response.text || "[]";
    return JSON.parse(cleanJson(text));
  } catch (error) {
    console.error("Error generating paths:", error);
    throw new Error("Failed to generate lesson paths.");
  }
};

export const generateCurriculum = async (subject: string, pillar: string, path: string): Promise<Curriculum> => {
  const prompt = `
    Create a detailed micro-curriculum for the lesson path: "${path}".
    Context: Subject is "${subject}", Pillar is "${pillar}".
    
    Include:
    1. 3-5 clear Learning Objectives.
    2. 3-5 Key Concepts to master.
    3. 3-5 Sub-lessons, where each has a title, content summary, and a practical action item (exercise).
    
    Return ONLY JSON.
  `;

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      pathTitle: { type: Type.STRING },
      objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
      keyConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
      subLessons: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            actionItem: { type: Type.STRING },
          },
          required: ["title", "content", "actionItem"],
        },
      },
    },
    required: ["pathTitle", "objectives", "keyConcepts", "subLessons"],
  };

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const text = response.text || "{}";
    return JSON.parse(cleanJson(text));
  } catch (error) {
    console.error("Error generating curriculum:", error);
    throw new Error("Failed to generate curriculum.");
  }
};

let chatSession: Chat | null = null;

export const initializeChat = (
  subject: string, 
  pillar: string, 
  path: string, 
  curriculum: Curriculum, 
  previousHistory: ChatMessage[] = []
) => {
  // Format history for the SDK: remove UI-specific messages (welcome/thinking) and map to Content parts
  const history = previousHistory
    .filter(msg => !msg.isThinking && msg.id !== 'welcome')
    .map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

  chatSession = ai.chats.create({
    model: MODEL_NAME,
    config: {
      systemInstruction: `
        You are an expert, friendly, and adaptive AI Tutor.
        You are currently teaching a student about "${subject}".
        The specific pillar is "${pillar}".
        The current lesson path is "${path}".
        
        The curriculum context is:
        Objectives: ${curriculum.objectives.join(', ')}
        Concepts: ${curriculum.keyConcepts.join(', ')}
        
        Your Goal:
        1. Answer questions clearly (ELI5 if asked).
        2. Identify gaps in knowledge.
        3. Suggest deeper dives or related topics if the user is curious.
        4. Be encouraging and structured.
        
        Keep responses concise and formatted with Markdown.
      `,
    },
    history: history.length > 0 ? history : undefined,
  });
};

export const sendMessageToTutor = async (message: string): Promise<string> => {
  if (!chatSession) {
    throw new Error("Chat session not initialized");
  }

  try {
    const result = await chatSession.sendMessage({ message });
    return result.text;
  } catch (error) {
    console.error("Chat error:", error);
    return "I'm having trouble connecting right now. Please try again.";
  }
};
