import mongoose from "mongoose";

const dbconnect = () => {
  try {
    const mongo_uri = "mongodb://localhost:27017/simple";
    mongoose.connect(mongo_uri);
    console.log("Mongodb connect succesfully.");
  } catch (error) {
    console.error(error);
  }
};

export default dbconnect;
