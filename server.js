const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= MIDDLEWARE =================
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));

// ================= DB =================
mongoose.connect("YOUR_MONGO_URL")
.then(() => console.log("✅ DB Connected"))
.catch(err => console.log(err));

// ================= SCHEMAS =================
const UserSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  phone: String,
  password: String,
  createdAt: String
});

const PostSchema = new mongoose.Schema({
  id: String,
  type: String,
  poster_user_id: String,
  name: String,
  phone: String,
  email: String,
  gender: String,
  message: String,
  location: String,
  room_type: String,
  rent_by_person: mongoose.Schema.Types.Mixed,
  imageLinks: [String],
  hidden: Boolean,
  timestamp: String,
  updatedAt: String
});

const MessageSchema = new mongoose.Schema({
  chatId: String,
  senderId: String,
  receiverId: String,
  message: String,
  postId: String,
  timestamp: String
});

const User = mongoose.model("User", UserSchema);
const Post = mongoose.model("Post", PostSchema);
const Message = mongoose.model("Message", MessageSchema);

// ================= AUTH =================
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  req.user = { id: token.split(":")[0] };
  next();
}

// ================= USER =================
app.post("/register", async (req, res) => {
  const user = await User.create({
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString()
  });

  res.json({ success: true, user });
});

app.post("/login", async (req, res) => {
  const { emailOrPhone, password } = req.body;

  const user = await User.findOne({
    $or: [{ email: emailOrPhone }, { phone: emailOrPhone }],
    password
  });

  if (!user) return res.status(401).json({ success: false });

  res.json({
    success: true,
    token: `${user.id}:${Date.now()}`,
    user
  });
});

app.get("/me", auth, async (req, res) => {
  const user = await User.findOne({ id: req.user.id });
  res.json(user);
});

// ================= POST ROOM =================
app.post("/post-room", auth, async (req, res) => {
  const post = await Post.create({
    id: uuidv4(),
    type: "room",
    poster_user_id: req.user.id,
    ...req.body,
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, postId: post.id });
});

// ================= GET ROOMS =================
app.get("/rooms", async (req, res) => {
  const posts = await Post.find({ type: "room", hidden: false });
  res.json(posts);
});

// ================= DELETE ROOM =================
app.delete("/room/:id", auth, async (req, res) => {
  const post = await Post.findOne({
    id: req.params.id,
    poster_user_id: req.user.id
  });

  if (!post) return res.status(404).json({ message: "Not found" });

  await Post.deleteOne({ id: req.params.id });

  res.json({ success: true });
});

// ================= ROOMMATE POST =================
app.post("/roommate", auth, async (req, res) => {
  const post = await Post.create({
    id: uuidv4(),
    type: "roommate",
    poster_user_id: req.user.id,
    ...req.body,
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, post });
});

// ================= ROOMMATE REPLY =================
app.post("/reply", auth, async (req, res) => {
  const { postId, message } = req.body;

  const post = await Post.findOne({ id: postId });
  if (!post) return res.status(404).json({ error: "Not found" });

  const chatId = `${req.user.id}_${post.poster_user_id}_${postId}`;

  await Message.create({
    chatId,
    senderId: req.user.id,
    receiverId: post.poster_user_id,
    message,
    postId,
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, chatId });
});

// ================= CHAT =================
app.get("/chat/:chatId", auth, async (req, res) => {
  const messages = await Message.find({
    chatId: req.params.chatId
  }).sort({ timestamp: 1 });

  res.json(messages);
});

// ================= UPDATE ROOM =================
app.patch("/room/:id", auth, async (req, res) => {
  await Post.updateOne(
    { id: req.params.id, poster_user_id: req.user.id },
    { $set: { ...req.body, updatedAt: new Date().toISOString() } }
  );

  res.json({ success: true });
});

// ================= WISHLIST =================
const wishlist = {};

app.post("/wishlist/add", auth, (req, res) => {
  const { postId } = req.body;

  if (!wishlist[req.user.id]) wishlist[req.user.id] = [];

  wishlist[req.user.id].push(postId);

  res.json({ success: true });
});

app.get("/wishlist", auth, async (req, res) => {
  const posts = await Post.find();
  const ids = wishlist[req.user.id] || [];

  res.json(posts.filter(p => ids.includes(p.id)));
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
