import { Elysia, t } from "elysia";
import cors from "@elysiajs/cors";
import staticPlugin from "@elysiajs/static";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import dbconnect from "./config/db";
import StoryData from "./model/StorySchema";

// Environment variables with defaults
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./public/uploads";
const MAX_DB_FILE_SIZE = 10 * 1024 * 1024; // 10MB (MongoDB document limit is 16MB)
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10000;
const MAX_WRITER_LENGTH = 100;

// Database connection with error handling
try {
  await dbconnect();
  console.log("✅ Database connected successfully");
} catch (error) {
  console.error("❌ Database connection failed:", error);
  process.exit(1);
}

// Ensure upload directory exists (for backward compatibility if needed)
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log(`📁 Created upload directory: ${UPLOAD_DIR}`);
}

// Types and Interfaces
interface Story {
  _id?: string;
  title: string;
  writter: string;
  story_content: string;
  image?: {
    data: Buffer;
    contentType: string;
    filename: string;
    size: number;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

interface PaginationQuery {
  page?: string;
  limit?: string;
  search?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: {
    current: number;
    total: number;
    hasNext: boolean;
    hasPrev: boolean;
    totalItems: number;
  };
}

// Utility Functions
const sanitizeString = (str: string): string => {
  return str
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
};

const validateImageFile = (file: File): string | null => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.";
  }

  if (file.size > MAX_DB_FILE_SIZE) {
    return `File size too large. Maximum size is ${
      MAX_DB_FILE_SIZE / (1024 * 1024)
    }MB.`;
  }

  return null;
};

const processImageForDB = async (file: File) => {
  const buffer = await file.arrayBuffer();
  return {
    data: Buffer.from(buffer),
    contentType: file.type,
    filename: file.name,
    size: file.size,
  };
};

const createResponse = <T>(
  success: boolean,
  data?: T,
  message?: string,
  pagination?: any
): ApiResponse<T> => {
  return { success, data, message, pagination };
};

// Validation Schemas
const storySchema = t.Object({
  title: t.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH }),
  writter: t.String({ minLength: 1, maxLength: MAX_WRITER_LENGTH }),
  story_content: t.String({ minLength: 1, maxLength: MAX_CONTENT_LENGTH }),
});

const querySchema = t.Object({
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  search: t.Optional(t.String()),
});

// Middleware
const errorHandler = (error: Error) => {
  console.error("API Error:", error);

  if (error.message.includes("validation")) {
    return new Response(
      JSON.stringify(
        createResponse(false, null, "Validation error: " + error.message)
      ),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (error.message.includes("Cast to ObjectId failed")) {
    return new Response(
      JSON.stringify(createResponse(false, null, "Invalid ID format")),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify(createResponse(false, null, "Internal server error")),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );
};

const requestLogger = (request: Request) => {
  if (NODE_ENV === "development") {
    console.log(
      `${new Date().toISOString()} - ${request.method} ${request.url}`
    );
  }
};

// Simple in-memory rate limiting (for basic protection)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const simpleRateLimit = (req: Request, maxRequests = 100, windowMs = 60000) => {
  const clientIP = req.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();
  const client = rateLimitStore.get(clientIP);

  if (!client || now > client.resetTime) {
    rateLimitStore.set(clientIP, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (client.count >= maxRequests) {
    return false;
  }

  client.count++;
  return true;
};

// Initialize Elysia with middleware
const app = new Elysia()
  .use(
    cors({
      origin: NODE_ENV === "production" ? ["your-domain.com"] : true,
      credentials: true,
    })
  )
  .use(
    staticPlugin({
      assets: "public",
      prefix: "/public",
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    })
  )
  .onRequest(({ request }) => {
    // Simple rate limiting check
    if (!simpleRateLimit(request, NODE_ENV === "production" ? 30 : 100)) {
      return new Response(
        JSON.stringify(
          createResponse(
            false,
            null,
            "Too many requests. Please try again later."
          )
        ),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        }
      );
    }

    requestLogger(request);
  })
  .onError(({ error }) => errorHandler(error));

// Routes

// Health check
app.get("/health", () =>
  createResponse(
    true,
    {
      status: "healthy",
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
    },
    "API is running"
  )
);

// Get all stories with pagination and search
app.get("/api", async ({ query }: { query: PaginationQuery }) => {
  try {
    const page = Math.max(1, parseInt(query.page || "1"));
    const limit = Math.min(50, Math.max(1, parseInt(query.limit || "10")));
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    // Build search filter
    const searchFilter = search
      ? {
          $or: [
            { title: { $regex: search, $options: "i" } },
            { writter: { $regex: search, $options: "i" } },
            { story_content: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    // Execute queries in parallel - exclude image data for list view
    const [stories, total] = await Promise.all([
      StoryData.find(searchFilter)
        .select("-image.data") // Exclude binary data for performance
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StoryData.countDocuments(searchFilter),
    ]);

    // Process stories to include image metadata
    const processedStories = stories.map((story) => ({
      ...story,
      image: story.image
        ? {
            filename: story.image.filename,
            contentType: story.image.contentType,
            size: story.image.size,
            hasImage: true,
          }
        : null,
    }));

    const totalPages = Math.ceil(total / limit);

    return createResponse(
      true,
      processedStories,
      "Stories fetched successfully",
      {
        current: page,
        total: totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        totalItems: total,
      }
    );
  } catch (error) {
    throw error;
  }
});

// Get single story by ID
app.get("/api/:id", async ({ params }: { params: { id: string } }) => {
  try {
    const story = await StoryData.findById(params.id)
      .select("-image.data") // Exclude binary data by default
      .lean();

    if (!story) {
      return new Response(
        JSON.stringify(createResponse(false, null, "Story not found")),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Process image metadata
    const responseStory = {
      ...story,
      image: story.image
        ? {
            filename: story.image.filename,
            contentType: story.image.contentType,
            size: story.image.size,
            hasImage: true,
          }
        : null,
    };

    return createResponse(true, responseStory, "Story fetched successfully");
  } catch (error) {
    throw error;
  }
});

// Get image by story ID
app.get("/api/:id/image", async ({ params }: { params: { id: string } }) => {
  try {
    const story = await StoryData.findById(params.id).select("image").lean();

    if (!story || !story.image || !story.image.data) {
      return new Response(
        JSON.stringify(createResponse(false, null, "Image not found")),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Return the image directly
    return new Response(story.image.data.buffer, {
      headers: {
        "Content-Type": story.image.contentType,
        "Content-Length": story.image.size.toString(),
        "Cache-Control": "public, max-age=86400", // Cache for 1 day
        "Content-Disposition": `inline; filename="${story.image.filename}"`,
      },
    });
  } catch (error) {
    throw error;
  }
});

// Create new story
app.post("/api", async ({ request }: { request: Request }) => {
  try {
    const formData = await request.formData();

    // Extract and validate text fields
    const title = sanitizeString((formData.get("title") as string) || "");
    const writter = sanitizeString((formData.get("writter") as string) || "");
    const story_content = sanitizeString(
      (formData.get("story_content") as string) || ""
    );

    // Validate required fields
    if (!title) {
      return new Response(
        JSON.stringify(createResponse(false, null, "Title is required")),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!writter) {
      return new Response(
        JSON.stringify(createResponse(false, null, "Writer name is required")),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!story_content) {
      return new Response(
        JSON.stringify(
          createResponse(false, null, "Story content is required")
        ),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate field lengths
    if (title.length > MAX_TITLE_LENGTH) {
      return new Response(
        JSON.stringify(
          createResponse(
            false,
            null,
            `Title must be less than ${MAX_TITLE_LENGTH} characters`
          )
        ),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (writter.length > MAX_WRITER_LENGTH) {
      return new Response(
        JSON.stringify(
          createResponse(
            false,
            null,
            `Writer name must be less than ${MAX_WRITER_LENGTH} characters`
          )
        ),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (story_content.length > MAX_CONTENT_LENGTH) {
      return new Response(
        JSON.stringify(
          createResponse(
            false,
            null,
            `Story content must be less than ${MAX_CONTENT_LENGTH} characters`
          )
        ),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle image upload for MongoDB storage
    let imageData = null;
    const imageFile = formData.get("image") as File;

    if (imageFile && imageFile.size > 0) {
      const validationError = validateImageFile(imageFile);
      if (validationError) {
        return new Response(
          JSON.stringify(createResponse(false, null, validationError)),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      imageData = await processImageForDB(imageFile);
    }

    // Check for duplicate titles
    const existingStory = await StoryData.findOne({ title: title }).lean();
    if (existingStory) {
      return new Response(
        JSON.stringify(
          createResponse(false, null, "A story with this title already exists")
        ),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create and save story
    const storyData = {
      title,
      writter,
      story_content,
      ...(imageData && { image: imageData }),
    };

    const story = new StoryData(storyData);
    await story.save();

    // Create response without sending binary data
    const responseStory = {
      ...story.toObject(),
      image: story.image
        ? {
            filename: story.image.filename,
            contentType: story.image.contentType,
            size: story.image.size,
            hasImage: true,
          }
        : null,
    };

    return new Response(
      JSON.stringify(
        createResponse(true, responseStory, "Story created successfully")
      ),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    throw error;
  }
});

// Update story
app.put(
  "/api/:id",
  async ({ params, request }: { params: { id: string }; request: Request }) => {
    try {
      const formData = await request.formData();

      // Find existing story first
      const existingStory = await StoryData.findById(params.id);
      if (!existingStory) {
        return new Response(
          JSON.stringify(createResponse(false, null, "Story not found")),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      // Extract and validate text fields
      const title = sanitizeString((formData.get("title") as string) || "");
      const writter = sanitizeString((formData.get("writter") as string) || "");
      const story_content = sanitizeString(
        (formData.get("story_content") as string) || ""
      );

      // Validate required fields
      if (!title || !writter || !story_content) {
        return new Response(
          JSON.stringify(
            createResponse(
              false,
              null,
              "All fields (title, writer, story_content) are required"
            )
          ),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Validate field lengths
      if (
        title.length > MAX_TITLE_LENGTH ||
        writter.length > MAX_WRITER_LENGTH ||
        story_content.length > MAX_CONTENT_LENGTH
      ) {
        return new Response(
          JSON.stringify(
            createResponse(
              false,
              null,
              "One or more fields exceed maximum length"
            )
          ),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Check for title conflicts with other stories
      const titleConflict = await StoryData.findOne({
        title: title,
        _id: { $ne: params.id },
      }).lean();

      if (titleConflict) {
        return new Response(
          JSON.stringify(
            createResponse(
              false,
              null,
              "Another story with this title already exists"
            )
          ),
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }

      // Handle image upload
      let imageData = existingStory.image;
      const imageFile = formData.get("image") as File;
      const removeImage = formData.get("removeImage") === "true";

      if (removeImage) {
        imageData = null;
      } else if (imageFile && imageFile.size > 0) {
        const validationError = validateImageFile(imageFile);
        if (validationError) {
          return new Response(
            JSON.stringify(createResponse(false, null, validationError)),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        imageData = await processImageForDB(imageFile);
      }

      // Update story
      const updateData = {
        title,
        writter,
        story_content,
        updatedAt: new Date(),
        ...(imageData !== undefined && { image: imageData }),
      };

      const updatedStory = await StoryData.findByIdAndUpdate(
        params.id,
        updateData,
        { new: true, runValidators: true }
      );

      // Create response without binary data
      const responseStory = {
        ...updatedStory.toObject(),
        image: updatedStory.image
          ? {
              filename: updatedStory.image.filename,
              contentType: updatedStory.image.contentType,
              size: updatedStory.image.size,
              hasImage: true,
            }
          : null,
      };

      return createResponse(true, responseStory, "Story updated successfully");
    } catch (error) {
      throw error;
    }
  }
);

// Delete story
app.delete("/api/:id", async ({ params }: { params: { id: string } }) => {
  try {
    const story = await StoryData.findById(params.id);

    if (!story) {
      return new Response(
        JSON.stringify(createResponse(false, null, "Story not found")),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Delete from database (image will be deleted automatically)
    await StoryData.findByIdAndDelete(params.id);

    return createResponse(true, null, "Story deleted successfully");
  } catch (error) {
    throw error;
  }
});

// Get stories statistics (bonus endpoint)
app.get("/api/stats", async () => {
  try {
    const stats = await StoryData.aggregate([
      {
        $group: {
          _id: null,
          totalStories: { $sum: 1 },
          totalWriters: { $addToSet: "$writter" },
          storiesWithImages: {
            $sum: { $cond: [{ $ifNull: ["$image", false] }, 1, 0] },
          },
          averageContentLength: { $avg: { $strLenCP: "$story_content" } },
          latestStory: { $max: "$createdAt" },
        },
      },
      {
        $project: {
          _id: 0,
          totalStories: 1,
          totalWriters: { $size: "$totalWriters" },
          storiesWithImages: 1,
          storiesWithoutImages: {
            $subtract: ["$totalStories", "$storiesWithImages"],
          },
          averageContentLength: { $round: ["$averageContentLength", 0] },
          latestStory: 1,
        },
      },
    ]);

    const result = stats[0] || {
      totalStories: 0,
      totalWriters: 0,
      storiesWithImages: 0,
      storiesWithoutImages: 0,
      averageContentLength: 0,
      latestStory: null,
    };

    return createResponse(true, result, "Statistics fetched successfully");
  } catch (error) {
    throw error;
  }
});

// Graceful shutdown
const gracefulShutdown = () => {
  console.log("\n🛑 Received shutdown signal, closing server gracefully...");
  process.exit(0);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Start server
app.listen(PORT, () => {
  console.log(`🦊 Elysia Story API is running at http://localhost:${PORT}`);
  console.log(`📝 Environment: ${NODE_ENV}`);
  console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Statistics: http://localhost:${PORT}/api/stats`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`  GET    /health           - Health check`);
  console.log(`  GET    /api              - Get all stories (with pagination)`);
  console.log(`  GET    /api/:id          - Get single story`);
  console.log(`  GET    /api/:id/image    - Get story image`);
  console.log(`  GET    /api/stats        - Get statistics`);
  console.log(`  POST   /api              - Create new story`);
  console.log(`  PUT    /api/:id          - Update story`);
  console.log(`  DELETE /api/:id          - Delete story`);
});
