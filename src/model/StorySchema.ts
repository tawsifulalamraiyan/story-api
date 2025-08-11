import mongoose from "mongoose";

const StorySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxLength: 200 },
    writter: { type: String, required: true, trim: true, maxLength: 100 },
    story_content: { type: String, required: true, maxLength: 10000 },

    // Image stored directly in MongoDB
    image: {
      data: { type: Buffer },
      contentType: { type: String },
      filename: { type: String },
      size: { type: Number },
    },
  },
  {
    timestamps: true,
    // Add index for better search performance
    indexes: [{ title: 1 }, { writter: 1 }, { createdAt: -1 }],
  }
);

// Add text index for search functionality
StorySchema.index({
  title: "text",
  writter: "text",
  story_content: "text",
});

const StoryData = mongoose.model("StoryData", StorySchema);

export default StoryData;
