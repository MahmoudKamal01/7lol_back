require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const morgan = require("morgan");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const certRoutes = require("./routes/certificates");
const studentRoutes = require("./routes/students");
const createAdmin = require("./utils/createAdmin");

const app = express();

app.use(express.json());
app.use(morgan("dev"));

app.use(cors());

app.get("/", (req, res) => res.json({ message: "API running" }));

app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/certificates", certRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

async function start() {
  await mongoose.connect(process.env.MONGODB_URI);
  await createAdmin();
  app.listen(process.env.PORT || 5000, () => console.log("Server listening"));
}
start();
