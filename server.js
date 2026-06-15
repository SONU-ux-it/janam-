require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const axios = require("axios");
const mongoose = require("mongoose");
const dns = require("dns");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://janam-cphc.onrender.com";
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!MONGO_URI || !JWT_SECRET || !IMGBB_API_KEY || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI, { dbName: "findnearroom" })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Error:", err.message);
    process.exit(1);
  });

// ================== ERROR HANDLING ==================
process.on("uncaughtException", (err) => logDetailedError("Uncaught Exception", err));
process.on("unhandledRejection", (reason) => logDetailedError("Unhandled Rejection", reason));

function logDetailedError(type, err) {
  console.error(`\n===== ${type} =====`);
  if (err && err.stack) {
    const stackLines = err.stack.split("\n");
    console.error(stackLines[0]);
    const fileLine = stackLines.find((line) => line.includes(".js"));
    if (fileLine) console.error("Error Location:", fileLine.trim());
  } else {
    console.error(err);
  }
  console.error("=================================================\n");
}

// ---------- Middleware ----------
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

const TMP_DIR = path.join(__dirname, "tmp_uploads");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed"), false);
  },
});

// ================== SCHEMAS ==================
const UserSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    phone: { type: String, required: true, unique: true, index: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
    createdAt: { type: String, default: () => new Date().toISOString(), immutable: true },
  },
  { versionKey: false }
);

const PostSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true, immutable: true },
    type: { type: String, enum: ["room", "roommate"], required: true, index: true, immutable: true },
    hidden: { type: Boolean, default: false, index: true },

    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    gender: { type: String, trim: true, lowercase: true },
    message: { type: String, trim: true },

    location: { type: String, trim: true, index: true },
    rent_by_person: mongoose.Schema.Types.Mixed,
    deposit: { type: String, trim: true },
    room_type: { type: String, trim: true, lowercase: true, index: true },
    available_from: { type: String, trim: true },
    facilities: mongoose.Schema.Types.Mixed,
    map_link: { type: String, trim: true },
    imageLinks: { type: [String], default: [] },

    poster_user_id: { type: String, index: true, immutable: true },
    posteruserid: { type: String, immutable: true },

    timestamp: { type: String, default: () => new Date().toISOString(), index: true, immutable: true },
    updatedAt: String,
  },
  { strict: true, versionKey: false }
);

const WishlistSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true },
    postId: { type: String, index: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false }
);
WishlistSchema.index({ userId: 1, postId: 1 }, { unique: true });

const PrivateMessageSchema = new mongoose.Schema(
  {
    chatId: { type: String, index: true },
    senderId: { type: String, index: true },
    senderName: String,
    senderPhone: String,
    receiverId: { type: String, index: true },
    postId: { type: String, index: true },
    message: { type: String, required: true, trim: true },
    timestamp: { type: String, default: () => new Date().toISOString(), index: true },
    read: { type: Boolean, default: false },
  },
  { versionKey: false }
);

const LegacyChatSchema = new mongoose.Schema(
  {
    postId: { type: String, index: true },
    senderName: String,
    senderEmail: String,
    message: String,
    timestamp: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false }
);

PostSchema.index({ type: 1, hidden: 1, gender: 1, room_type: 1, timestamp: -1 });
PostSchema.index({ type: 1, hidden: 1, poster_user_id: 1, timestamp: -1 });
PrivateMessageSchema.index({ chatId: 1, timestamp: 1 });

const User = mongoose.model("User", UserSchema);
const Post = mongoose.model("Post", PostSchema);
const Wishlist = mongoose.model("Wishlist", WishlistSchema);
const PrivateMessage = mongoose.model("PrivateMessage", PrivateMessageSchema);
const LegacyChat = mongoose.model("LegacyChat", LegacyChatSchema);

// ================== HELPERS ==================
function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone = "") {
  return String(phone).trim();
}

function getPosterUserId(post) {
  return post?.poster_user_id || post?.posteruserid || null;
}

function buildNormalizedChatId(userA, userB, postId) {
  const ids = [String(userA), String(userB)].sort();
  return `${ids[0]}_${ids[1]}_${postId}`;
}

function parseChatId(chatId) {
  if (!chatId || typeof chatId !== "string") return null;
  if (!chatId.includes("_")) return null;

  const parts = chatId.split("_");
  if (parts.length !== 3) return null;

  const [user1, user2, postId] = parts;
  if (!user1 || !user2 || !postId) return null;

  return { user1, user2, postId };
}

function getChatAccessInfo(chatId, currentUserId) {
  const parsed = parseChatId(chatId);
  if (!parsed) return { ok: false, reason: "Invalid chatId format" };

  const { user1, user2, postId } = parsed;
  if (user1 !== currentUserId && user2 !== currentUserId) {
    return { ok: false, reason: "You do not have access to this chat" };
  }

  const otherUserId = user1 === currentUserId ? user2 : user1;
  return { ok: true, user1, user2, postId, otherUserId };
}

function buildRoomQuery(query) {
  const mongoQuery = {
    type: "room",
    hidden: { $ne: true },
  };

  if (query.city) {
    mongoQuery.location = { $regex: String(query.city).trim(), $options: "i" };
  }

  if (query.type) {
    mongoQuery.room_type = { $regex: String(query.type).trim(), $options: "i" };
  }

  if (query.gender) {
    const g = String(query.gender).trim().toLowerCase();
    if (g === "boys" || g === "girls") {
      mongoQuery.gender = { $in: [g, "both"] };
    } else {
      mongoQuery.gender = { $regex: `^${g}$`, $options: "i" };
    }
  }

  return mongoQuery;
}

function getMinimumRentValue(value) {
  try {
    if (typeof value === "object" && value !== null) {
      const values = Object.values(value)
        .map((v) => parseInt(String(v).replace(/\D/g, "")))
        .filter((v) => !isNaN(v));
      return values.length ? Math.min(...values) : NaN;
    }
    return parseInt(String(value || "").replace(/\D/g, ""));
  } catch {
    return NaN;
  }
}

function pickAllowedFields(source, allowedFields) {
  const output = {};
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      output[key] = source[key];
    }
  }
  return output;
}

function validateRoomPayload(body) {
  const requiredFields = ["name", "phone", "email", "room_type", "gender", "location"];
  for (const field of requiredFields) {
    if (!String(body[field] || "").trim()) {
      return `${field} is required`;
    }
  }
  return null;
}

function validateRoommatePayload(body) {
  const requiredFields = ["name", "message", "gender", "phone", "email"];
  for (const field of requiredFields) {
    if (!String(body[field] || "").trim()) {
      return `${field} is required`;
    }
  }
  return null;
}

async function authenticateToken(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    const token = parts[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role === "admin") {
      req.user = {
        id: decoded.id || null,
        username: decoded.username,
        role: "admin",
        isAdmin: true,
      };
      return next();
    }

    if (!decoded.id) {
      return res.status(401).json({ success: false, message: "Invalid token payload" });
    }

    const user = await User.findOne({ id: decoded.id }).select("id name email phone role");
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role || "user",
      isAdmin: user.role === "admin",
    };

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required" });
  }
  next();
}

async function uploadFileToImgBB(localPath) {
  try {
    const fileBuffer = fs.readFileSync(localPath);
    const base64Image = fileBuffer.toString("base64");

    const formData = new URLSearchParams();
    formData.append("key", IMGBB_API_KEY);
    formData.append("image", base64Image);

    const response = await axios.post("https://api.imgbb.com/1/upload", formData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 120000,
    });

    fs.unlink(localPath, () => {});

    if (!response.data?.data?.url) {
      throw new Error("ImgBB upload failed: no URL returned");
    }

    return response.data.data.url;
  } catch (err) {
    try {
      fs.unlinkSync(localPath);
    } catch {}
    console.error("Error while uploading to ImgBB:", err.message);
    throw err;
  }
}

// ================= ROUTES =================

// REGISTER
app.post("/user-register", async (req, res) => {
  try {
    let { name, email, phone, password } = req.body;

    name = String(name || "").trim();
    email = normalizeEmail(email);
    phone = normalizePhone(phone);
    password = String(password || "");

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const existing = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Email or phone already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: uuidv4(),
      name,
      email,
      phone,
      password: hashedPassword,
      role: "user",
      createdAt: new Date().toISOString(),
    };

    await User.create(newUser);

    res.json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: "Email or phone already registered" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// LOGIN
app.post("/user-login", async (req, res) => {
  try {
    let { emailOrPhone, password } = req.body;

    emailOrPhone = String(emailOrPhone || "").trim();
    password = String(password || "");

    if (!emailOrPhone || !password) {
      return res.status(400).json({
        success: false,
        message: "Email / phone and password required",
      });
    }

    const normalizedEmail = normalizeEmail(emailOrPhone);

    const user = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone: emailOrPhone }],
    }).select("+password");

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const matched = await bcrypt.compare(password, user.password);
    if (!matched) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role || "user" },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role || "user",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CURRENT USER
app.get("/me", authenticateToken, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// GET USER BY ID
app.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.id }).select("id name phone email createdAt role -_id");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      user,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WISHLIST ADD
app.post("/wishlist/add", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json({ success: false, message: "postId is required" });
    }

    const post = await Post.findOne({ id: postId, type: "room" });
    if (!post) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const exists = await Wishlist.findOne({ userId: req.user.id, postId });
    if (exists) {
      return res.status(409).json({ success: false, message: "Room already in wishlist" });
    }

    await Wishlist.create({
      userId: req.user.id,
      postId,
      createdAt: new Date().toISOString(),
    });

    const total = await Wishlist.countDocuments({ userId: req.user.id });

    res.json({
      success: true,
      message: "Added to wishlist",
      postId,
      total,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: "Room already in wishlist" });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// WISHLIST REMOVE
app.post("/wishlist/remove", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json({ success: false, message: "postId is required" });
    }

    await Wishlist.deleteOne({ userId: req.user.id, postId });
    const total = await Wishlist.countDocuments({ userId: req.user.id });

    res.json({
      success: true,
      message: "Removed from wishlist",
      postId,
      total,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET WISHLIST
app.get("/wishlist", authenticateToken, async (req, res) => {
  try {
    const wishlistItems = await Wishlist.find({ userId: req.user.id }).sort({ createdAt: -1 });
    const wishlistIds = wishlistItems.map((w) => w.postId);
 
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CHECK WISHLIST ITEM
app.get("/wishlist/:postId", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const exists = await Wishlist.findOne({ userId: req.user.id, postId });

    res.json({
      success: true,
      postId,
      isInWishlist: !!exists,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST ROOM
app.post("/post-room", authenticateToken, upload.array("photos", 12), async (req, res) => {
  try {
    const validationError = validateRoomPayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    let {
      name,
      phone,
      email,
      room_type,
      gender,
      facilities,
      deposit,
      available_from,
      location,
      map_link,
      rent_by_person,
    } = req.body;

    name = String(name || "").trim();
    phone = normalizePhone(phone);
    email = normalizeEmail(email);
    room_type = String(room_type || "").trim().toLowerCase();
    gender = String(gender || "").trim().toLowerCase();
    deposit = String(deposit || "").trim();
    available_from = String(available_from || "").trim();
    location = String(location || "").trim();
    map_link = String(map_link || "").trim();

    let imageLinks = [];
    let parsedRentByPerson = rent_by_person || "";
    let parsedFacilities = facilities || "";

    try {
      if (typeof rent_by_person === "string") parsedRentByPerson = JSON.parse(rent_by_person);
    } catch {}

    try {
      if (typeof facilities === "string" && (facilities.startsWith("[") || facilities.startsWith("{"))) {
        parsedFacilities = JSON.parse(facilities);
      }
    } catch {}

    if (req.files?.length) {
      const uploadResults = await Promise.all(
        req.files.map(async (file) => {
          try {
            return await uploadFileToImgBB(file.path);
          } catch (e) {
            console.error("❌ Image upload failed:", e.message);
            return null;
          }
        })
      );
      imageLinks = uploadResults.filter(Boolean);
    }

    const newRoom = {
      id: uuidv4(),
      name,
      phone,
      email,
      gender,
      location,
      rent_by_person: parsedRentByPerson,
      deposit,
      room_type,
      available_from,
      facilities: parsedFacilities,
      map_link,
      imageLinks,
      type: "room",
      poster_user_id: req.user.id,
      hidden: false,
      timestamp: new Date().toISOString(),
    };

    await Post.create(newRoom);

    res.json({
      success: true,
      message: "Room posted successfully",
      links: imageLinks,
      id: newRoom.id,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/mongo-test", async (req, res) => {
  try {
    const count = await Post.countDocuments();
    res.json({
      mongoConnected: mongoose.connection.readyState,
      totalPosts: count
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});
// MY ROOMS
app.get("/my-rooms", authenticateToken, async (req, res) => {
  try {
    const posts = await Post.find({
      type: "room",
      $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
    }).sort({ timestamp: -1 });

    res.json({ success: true, rooms: posts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE MY ROOM
app.delete("/my-room/:postId", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findOne({
      id: postId,
      type: "room",
      $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Room post not found or you don't have permission to delete it",
      });
    }

    await Post.deleteOne({ id: postId, type: "room" });
    await Wishlist.deleteMany({ postId });

    res.json({
      success: true,
      message: "Room post deleted successfully",
      postId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// EDIT ROOM
app.patch("/edit-room/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const allowedRoomFields = [
      "name",
      "phone",
      "email",
      "gender",
      "location",
      "rent_by_person",
      "deposit",
      "room_type",
      "available_from",
      "facilities",
      "map_link",
      "imageLinks",
    ];

    const safeUpdates = pickAllowedFields(req.body, allowedRoomFields);

    if (safeUpdates.email) safeUpdates.email = normalizeEmail(safeUpdates.email);
    if (safeUpdates.phone) safeUpdates.phone = normalizePhone(safeUpdates.phone);
    if (safeUpdates.gender) safeUpdates.gender = String(safeUpdates.gender).trim().toLowerCase();
    if (safeUpdates.room_type) safeUpdates.room_type = String(safeUpdates.room_type).trim().toLowerCase();

    const updatedPost = await Post.findOneAndUpdate(
      {
        id,
        type: "room",
        $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
      },
      {
        $set: {
          ...safeUpdates,
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true }
    );

    if (!updatedPost) {
      return res.status(404).json({
        success: false,
        message: "Room not found or not yours",
      });
    }

    res.json({
      success: true,
      message: "Room updated successfully",
      room: updatedPost,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TOGGLE ROOM
app.patch("/toggle-room/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const post = await Post.findOne({
      id,
      type: "room",
      $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
    });

    if (!post) {
      return res.status(404).json({ success: false, message: "Room not found or not yours" });
    }

    post.hidden = !post.hidden;
    post.updatedAt = new Date().toISOString();
    await post.save();

    res.json({
      success: true,
      hidden: post.hidden,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ROOMMATE POST
app.post("/roommate-post", authenticateToken, async (req, res) => {
  try {
    const validationError = validateRoommatePayload(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    let { name, message, gender, phone, email } = req.body;

    name = String(name || "").trim();
    message = String(message || "").trim();
    gender = String(gender || "").trim().toLowerCase();
    phone = normalizePhone(phone);
    email = normalizeEmail(email);

    const newPost = {
      id: uuidv4(),
      name,
      email,
      message,
      gender,
      phone,
      poster_user_id: req.user.id,
      type: "roommate",
      hidden: false,
      timestamp: new Date().toISOString(),
    };

    await Post.create(newPost);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MY ROOMMATE POSTS
app.get("/my-roommate-posts", authenticateToken, async (req, res) => {
  try {
    const posts = await Post.find({
      type: "roommate",
      $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
    }).sort({ timestamp: -1 });

    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE MY ROOMMATE POST
app.delete("/my-roommate-post/:postId", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findOne({
      id: postId,
      type: "roommate",
      $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Roommate post not found or you don't have permission to delete it",
      });
    }

    await Post.deleteOne({ id: postId, type: "roommate" });

    res.json({
      success: true,
      message: "Roommate post deleted successfully",
      postId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// EDIT MY ROOMMATE POST
app.patch("/my-roommate-post/:postId", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.params;

    const allowedRoommateFields = ["name", "message", "gender", "phone", "email"];
    const safeUpdates = pickAllowedFields(req.body, allowedRoommateFields);

    if (safeUpdates.email) safeUpdates.email = normalizeEmail(safeUpdates.email);
    if (safeUpdates.phone) safeUpdates.phone = normalizePhone(safeUpdates.phone);
    if (safeUpdates.gender) safeUpdates.gender = String(safeUpdates.gender).trim().toLowerCase();

    const result = await Post.findOneAndUpdate(
      {
        id: postId,
        type: "roommate",
        $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
      },
      {
        $set: {
          ...safeUpdates,
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Roommate post not found or you don't have permission to edit it",
      });
    }

    res.json({
      success: true,
      message: "Roommate post updated successfully",
      post: result,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ROOMMATE HIDE
app.patch("/roommate-hide/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const post = await Post.findOne({
      id,
      type: "roommate",
      $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
    });

    if (!post) {
      return res.status(404).json({ success: false, message: "Roommate post not found or not yours" });
    }

    post.hidden = !post.hidden;
    post.updatedAt = new Date().toISOString();
    await post.save();

    res.json({ success: true, hidden: post.hidden });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ROOMMATE EDIT
app.patch("/roommate-edit/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const allowedRoommateFields = ["name", "message", "gender", "phone", "email"];
    const safeUpdates = pickAllowedFields(req.body, allowedRoommateFields);

    if (safeUpdates.email) safeUpdates.email = normalizeEmail(safeUpdates.email);
    if (safeUpdates.phone) safeUpdates.phone = normalizePhone(safeUpdates.phone);
    if (safeUpdates.gender) safeUpdates.gender = String(safeUpdates.gender).trim().toLowerCase();

    const post = await Post.findOneAndUpdate(
      {
        id,
        type: "roommate",
        $or: [{ poster_user_id: req.user.id }, { posteruserid: req.user.id }],
      },
      {
        $set: {
          ...safeUpdates,
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ success: false, message: "Roommate post not found or not yours" });
    }

    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ROOMMATE REPLY
app.post("/roommate-reply", authenticateToken, async (req, res) => {
  try {
    const { postId } = req.body;
    const post = await Post.findOne({ id: postId, type: "roommate" });

    if (!post) {
      return res.status(404).json({ success: false, error: "Invalid roommate post." });
    }

    if (getPosterUserId(post) === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "You cannot reply to your own roommate post",
      });
    }

    const chatId = buildNormalizedChatId(req.user.id, getPosterUserId(post), postId);

    res.json({
      success: true,
      chatLink: `${BASE_URL}/roommate-reply.html?chatId=${chatId}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PRIVATE MESSAGE
app.post("/private-message", authenticateToken, async (req, res) => {
  try {
    const { targetUserId, postId, message, chatId: incomingChatId } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "message is required" });
    }

    if (incomingChatId) {
      const access = getChatAccessInfo(incomingChatId, req.user.id);
      if (!access.ok) {
        return res.status(403).json({ success: false, message: access.reason });
      }

      const normalizedIncomingChatId = buildNormalizedChatId(access.user1, access.user2, access.postId);

      await PrivateMessage.create({
        chatId: normalizedIncomingChatId,
        senderId: req.user.id,
        senderName: req.user.name || req.user.phone,
        senderPhone: req.user.phone || "",
        receiverId: access.otherUserId,
        postId: access.postId,
        message: String(message).trim(),
        timestamp: new Date().toISOString(),
        read: false,
      });

      return res.json({
        success: true,
        message: "Message sent successfully",
        chatId: normalizedIncomingChatId,
      });
    }

    if (!targetUserId || !postId) {
      return res.status(400).json({
        success: false,
        message: "targetUserId, postId, and message required",
      });
    }

    if (String(targetUserId) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You cannot message yourself" });
    }

    const builtChatId = buildNormalizedChatId(req.user.id, targetUserId, postId);

    await PrivateMessage.create({
      chatId: builtChatId,
      senderId: req.user.id,
      senderName: req.user.name,
      senderPhone: req.user.phone,
      receiverId: targetUserId,
      postId,
      message: String(message).trim(),
      timestamp: new Date().toISOString(),
      read: false,
    });

    res.json({
      success: true,
      message: "Message sent successfully",
      chatId: builtChatId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MY CHATS
app.get("/my-chats", authenticateToken, async (req, res) => {
  try {
    const grouped = await PrivateMessage.aggregate([
      {
        $match: {
          $or: [{ senderId: req.user.id }, { receiverId: req.user.id }],
        },
      },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: "$chatId",
          lastMessage: { $last: "$message" },
          lastMessageTime: { $last: "$timestamp" },
          postId: { $last: "$postId" },
          createdAt: { $first: "$timestamp" },
          totalUnread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiverId", req.user.id] },
                    { $eq: ["$read", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { lastMessageTime: -1 } },
    ]);

    const users = await User.find().select("id name phone -_id");
    const userMap = {};
    users.forEach((u) => {
      userMap[u.id] = u;
    });

    const chatsArray = grouped
      .map((item) => {
        const access = getChatAccessInfo(item._id, req.user.id);
        if (!access.ok) return null;

        const otherUser = userMap[access.otherUserId];

        return {
          chatId: item._id,
          otherUserId: access.otherUserId,
          otherUserName: otherUser?.name || "Unknown",
          otherUserPhone: otherUser?.phone || "",
          postId: item.postId,
          lastMessage: item.lastMessage || "Say hello! 👋",
          lastMessageTime: item.lastMessageTime || item.createdAt || "",
          createdAt: item.createdAt || "",
          totalUnread: item.totalUnread || 0,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      chats: chatsArray,
      totalChats: chatsArray.length,
      totalUnread: chatsArray.reduce((sum, c) => sum + (c.totalUnread || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MY MESSAGES
app.get("/my-messages", authenticateToken, async (req, res) => {
  try {
    const grouped = await PrivateMessage.aggregate([
      {
        $match: {
          $or: [{ senderId: req.user.id }, { receiverId: req.user.id }],
        },
      },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: "$chatId",
          lastMessageObj: {
            $last: {
              message: "$message",
              timestamp: "$timestamp",
              senderId: "$senderId",
              receiverId: "$receiverId",
              postId: "$postId",
              read: "$read",
            },
          },
          postId: { $last: "$postId" },
          totalUnread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiverId", req.user.id] },
                    { $eq: ["$read", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { "lastMessageObj.timestamp": -1 } },
    ]);

    const users = await User.find().select("id name phone -_id");
    const userMap = {};
    users.forEach((u) => {
      userMap[u.id] = u;
    });

    const chatsArray = grouped
      .map((item) => {
        const access = getChatAccessInfo(item._id, req.user.id);
        if (!access.ok) return null;

        const otherUser = userMap[access.otherUserId];

        return {
          user: otherUser || { id: access.otherUserId, name: "Unknown", phone: "" },
          postId: item.postId,
          lastMessage: item.lastMessageObj,
          totalUnread: item.totalUnread || 0,
          chatId: item._id,
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      chats: chatsArray,
      totalChats: chatsArray.length,
      totalUnread: chatsArray.reduce((sum, chat) => sum + chat.totalUnread, 0),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET CHAT
app.get("/chat/:chatId", authenticateToken, async (req, res) => {
  try {
    const normalizedChatId = (() => {
      const parsed = parseChatId(req.params.chatId);
      if (!parsed) return req.params.chatId;
      return buildNormalizedChatId(parsed.user1, parsed.user2, parsed.postId);
    })();

    const access = getChatAccessInfo(normalizedChatId, req.user.id);
    if (!access.ok) {
      return res.status(403).json({
        success: false,
        message: access.reason,
        chatId: normalizedChatId,
        messages: [],
        isEmpty: true,
      });
    }

    const messages = await PrivateMessage.find({ chatId: normalizedChatId }).sort({ timestamp: 1 });

    res.json({
      success: true,
      chatId: normalizedChatId,
      messages,
      isEmpty: messages.length === 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// MARK READ
app.patch("/chat/:chatId/read", authenticateToken, async (req, res) => {
  try {
    const normalizedChatId = (() => {
      const parsed = parseChatId(req.params.chatId);
      if (!parsed) return req.params.chatId;
      return buildNormalizedChatId(parsed.user1, parsed.user2, parsed.postId);
    })();

    const access = getChatAccessInfo(normalizedChatId, req.user.id);
    if (!access.ok) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    await PrivateMessage.updateMany(
      { chatId: normalizedChatId, receiverId: req.user.id, read: false },
      { $set: { read: true } }
    );

    res.json({ success: true, message: "Messages marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET SINGLE POST - PUBLIC
app.get("/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findOne({
      id,
      hidden: { $ne: true },
    });

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const owner = getPosterUserId(post)
      ? await User.findOne({ id: getPosterUserId(post) }).select("id name phone email -_id")
      : null;

    res.json({
      success: true,
      post: {
        ...post.toObject(),
        poster_user_id: getPosterUserId(post),
        owner: owner || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUBLIC ROOMS
app.get("/api/rooms", async (req, res) => {
  try {
    const { budget } = req.query;
    const mongoQuery = buildRoomQuery(req.query);

    let posts = await Post.find(mongoQuery).sort({ timestamp: -1 });

    if (budget) {
      const b = parseInt(budget);
      posts = posts.filter((p) => {
        const rentNum = getMinimumRentValue(p.rent_by_person || p.deposit);
        return isNaN(b) || (isNaN(rentNum) ? true : rentNum <= b);
      });
    }

    res.json(posts);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ROOM POSTS
app.get("/room-posts", async (req, res) => {
  try {
    const { budget } = req.query;
    const mongoQuery = buildRoomQuery(req.query);

    let posts = await Post.find(mongoQuery).sort({ timestamp: -1 });

    if (budget) {
      const b = parseInt(budget);
      posts = posts.filter((p) => {
        const rentNum = getMinimumRentValue(p.rent_by_person);
        return isNaN(b) || (isNaN(rentNum) ? true : rentNum <= b);
      });
    }

    res.json(posts);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUBLIC ROOMMATE POSTS
app.get("/roommate-posts", async (req, res) => {
  try {
    const posts = await Post.find({
      type: "roommate",
      hidden: { $ne: true },
    }).sort({ timestamp: -1 });

    res.json(posts);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// LEGACY PRIVATE REPLY
app.post("/private-reply", async (req, res) => {
  try {
    const { postId, senderName, senderEmail, message } = req.body;

    if (!postId || !senderName || !senderEmail || !message) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    await LegacyChat.create({
      postId,
      senderName: String(senderName).trim(),
      senderEmail: normalizeEmail(senderEmail),
      message: String(message).trim(),
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/private-reply/:postId", async (req, res) => {
  try {
    const chats = await LegacyChat.find({ postId: req.params.postId }).sort({ timestamp: 1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ADMIN LOGIN
app.post("/admin-login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { role: "admin", username: ADMIN_USERNAME },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({ success: true, token, role: "admin" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ADMIN DATA
app.get("/admin-data", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rooms = await Post.find({ type: "room" }).sort({ timestamp: -1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ADMIN TOGGLE ROOM
app.patch("/admin/toggle-room/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id, type: "room" });
    if (!post) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    post.hidden = !post.hidden;
    post.updatedAt = new Date().toISOString();
    await post.save();

    res.json({ success: true, hidden: post.hidden });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ADMIN EDIT ROOM
app.patch("/admin/edit-room/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const allowedRoomFields = [
      "name",
      "phone",
      "email",
      "gender",
      "location",
      "rent_by_person",
      "deposit",
      "room_type",
      "available_from",
      "facilities",
      "map_link",
      "imageLinks",
      "hidden",
    ];

    const safeUpdates = pickAllowedFields(req.body, allowedRoomFields);

    if (safeUpdates.email) safeUpdates.email = normalizeEmail(safeUpdates.email);
    if (safeUpdates.phone) safeUpdates.phone = normalizePhone(safeUpdates.phone);
    if (safeUpdates.gender) safeUpdates.gender = String(safeUpdates.gender).trim().toLowerCase();
    if (safeUpdates.room_type) safeUpdates.room_type = String(safeUpdates.room_type).trim().toLowerCase();

    const post = await Post.findOneAndUpdate(
      { id: req.params.id, type: "room" },
      { $set: { ...safeUpdates, updatedAt: new Date().toISOString() } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TEST ROUTES
app.get("/api/test", async(req, res) => {
  res.json({ success: true, message: "API Perfect ✅" });
});

app.get("/api/health",async (req, res) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("❌ ERROR:", err.message);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Backend running at ${BASE_URL}`);
});
