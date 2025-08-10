import mongoose from "mongoose";

const StorySchema = new mongoose.Schema({
  id: { type: Number },
  title: { type: String, require },
  writter: { type: String, require },
  Story_content: { type: String, require },
});

const StoryData = mongoose.model("StoryData", StorySchema);

export default StoryData;
