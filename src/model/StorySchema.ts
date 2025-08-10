import mongoose from "mongoose";

const StorySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    writter: { type: String, required: true },
    story_content: { type: String, required: true }, // lowercase 's'!
  },
  { timestamps: true }
);

const StoryData = mongoose.model("StoryData", StorySchema);

export default StoryData;
