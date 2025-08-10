import { Elysia } from "elysia";
import cors from "@elysiajs/cors";
import dbconnect from "./config/db";
import StoryData from "./model/StorySchema";

// Connect to DB (make sure MONGODB_URI is set in Vercel env)
dbconnect();

const app = new Elysia();

// Enable CORS
app.use(cors());

// Routes
app.get("/", () => {
  return { message: "API is running" };
});

app.get("/api", async () => {
  const story_data = await StoryData.find().sort({ createdAt: -1 });
  return story_data;
});

app.post("/api", async ({ body }: { body: any }) => {
  if (!body.title) return { message: "Title is required" };
  if (!body.writter) return { message: "Writer is required" };
  if (!body.story_content) return { message: "Story content is required" };

  const { title, writter, story_content } = body;
  const story_data = new StoryData({ title, writter, story_content });
  await story_data.save();

  return story_data;
});

app.delete("/api/:id", async ({ params }: { params: { id: string } }) => {
  try {
    const deleted = await StoryData.findByIdAndDelete(params.id);
    if (!deleted) {
      return { message: "Story not found" };
    }
    return { message: "Story deleted successfully" };
  } catch (error) {
    return { message: "Failed to delete story", error };
  }
});

app.get("/api/:id", async ({ params }) => {
  try {
    const story = await StoryData.findById(params.id);
    if (!story) {
      return new Response(JSON.stringify({ message: "Story not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(story), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ message: "Invalid story ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ✅ Do NOT use app.listen in Vercel
export default app.handle;
