import mongoose from "mongoose";

const dbconnect = () => {
  try {
    const mongo_uri =
      "mongodb+srv://raiyan:raiyan2002@cluster0.0wvpgdb.mongodb.net/storydb?retryWrites=true&w=majority&appName=Cluster0";
    mongoose.connect(mongo_uri);
    console.log("Mongodb connect succesfully.");
  } catch (error) {
    console.error(error);
  }
};

export default dbconnect;
