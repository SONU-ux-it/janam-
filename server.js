const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const axios = require("axios");


const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;


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


// 👇 ImgBB API key
const IMGBB_API_KEY = "9a995e9e45e2bd450029bd6cdafe22c3";


// ✅ FIXED Multer setup - Handle empty files properly
const upload = multer({
  dest: path.join(__dirname, "tmp_uploads/"),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed"), false);
    }
  },
});


// ---------- Middleware ----------
app.use(
  cors({
    origin: "*",
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));


// Serve static files
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));


// ✅ AUTHENTICATION MIDDLEWARE (NEW - REUSABLE)
function authenticateToken(req, res, next) {
  const auth = req.headers.authorization || "";
  const parts = auth.split(" ");


  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ success: false, message: "No token provided" });
  }


  const token = parts[1];
  const userId = token.split(":")[0];


  const users = loadUsers();
  const user = users.find((u) => u.id === userId);


  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }


  req.user = user;
  next();
}


// ✅ HELPER FUNCTION: Get poster user ID (backward compatible)
function getPosterUserId(post) {
  return post.poster_user_id || post.posteruserid || null;
}


// ✅ NEW HELPER: Parse chatId safely (supports "_" or "|" as delimiter)
function parseChatId(chatId) {
  if (!chatId || typeof chatId !== "string") return null;


  // Only "_" delimiter (frontend uses underscore)
  if (!chatId.includes("_")) return null;


  const parts = chatId.split("_");
  if (parts.length !== 3) return null; // Exactly 3 parts: user1_user2_postId


  const user1 = parts[0];
  const user2 = parts[1];
  const postId = parts[2];


  if (!user1 || !user2 || !postId) return null;


  return { user1, user2, postId, delimiter: "_" };
}


// ✅ NEW HELPER: Check chat access + find other user
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


// ---------- Data Storage ----------
const POSTS_FILE = path.join(__dirname, "posts.json");
const CHAT_FILE = path.join(__dirname, "roommate-reply.json");
const USERS_FILE = path.join(__dirname, "users.json");
const WISHLIST_FILE = path.join(__dirname, "wishlist.json");
const PRIVATE_MESSAGES_FILE = path.join(__dirname, "private-messages.json"); // ✅ NEW: Private messages


function loadPosts() {
  if (!fs.existsSync(POSTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(POSTS_FILE, "utf-8") || "[]");
  } catch (e) {
    console.error("Error reading posts.json:", e);
    return [];
  }
}
function savePosts(posts) {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}

function loadChats() {
  if (!fs.existsSync(CHAT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CHAT_FILE, "utf-8") || "{}");
  } catch (e) {
    console.error("Error reading chats file:", e);
    return {};
  }
}
function saveChats(chats) {
  fs.writeFileSync(CHAT_FILE, JSON.stringify(chats, null, 2));
}


function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8") || "[]");
  } catch (e) {
    console.error("Error reading users.json:", e);
    return [];
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}


// ✅ Wishlist Functions
function loadWishlist() {
  if (!fs.existsSync(WISHLIST_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(WISHLIST_FILE, "utf-8") || "{}");
  } catch (e) {
    console.error("Error reading wishlist.json:", e);
    return {};
  }
}
function saveWishlist(wishlist) {
  fs.writeFileSync(WISHLIST_FILE, JSON.stringify(wishlist, null, 2));
}


// ✅ NEW: Private Messages Functions
function loadPrivateMessages() {
  if (!fs.existsSync(PRIVATE_MESSAGES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PRIVATE_MESSAGES_FILE, "utf-8") || "{}");
  } catch (e) {
    console.error("Error reading private-messages.json:", e);
    return {};
  }
}
function savePrivateMessages(messages) {
  fs.writeFileSync(PRIVATE_MESSAGES_FILE, JSON.stringify(messages, null, 2));
}


// ensure tmp_uploads exists
const TMP_DIR = path.join(__dirname, "tmp_uploads");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);


// ========= ImgBB Upload Helper =========
async function uploadFileToImgBB(localPath) {
  try {
    const fileBuffer = fs.readFileSync(localPath);
    const base64Image = fileBuffer.toString("base64");


    const formData = new URLSearchParams();
    formData.append("key", IMGBB_API_KEY);
    formData.append("image", base64Image);


    const response = await axios.post("https://api.imgbb.com/1/upload", formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 120000,
    });


    fs.unlink(localPath, () => {});


    if (!response.data || !response.data.data || !response.data.data.url) {
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


// ✅ USER REGISTER - CORRECT ENDPOINT
app.post("/user-register", (req, res) => {
  const { name, email, phone, password } = req.body;


  if (!name || !email || !phone || !password) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }


  const users = loadUsers();


  const existing = users.find((u) => u.email === email || u.phone === phone);
  if (existing) {
    return res.status(409).json({ success: false, message: "Email or phone already registered" });
  }


  const newUser = {
    id: uuidv4(),
    name,
    email,
    phone,
    password,
    createdAt: new Date().toISOString(),
  };


  users.push(newUser);
  saveUsers(users);


  res.json({
    success: true,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
    },
  });
});


// ✅ USER LOGIN - CORRECT ENDPOINT
app.post("/user-login", (req, res) => {
  const { emailOrPhone, password } = req.body;


  if (!emailOrPhone || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email / phone and password required" });
  }


  const users = loadUsers();


  const user = users.find(
    (u) =>
      (u.email === emailOrPhone || u.phone === emailOrPhone) && u.password === password
  );


  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }


  const token = `${user.id}:${Date.now()}`;


  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
    },
  });
});


// ✅ CURRENT USER - FIXED WITH MIDDLEWARE
app.get("/me", authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});


// ✅======================= WISHLIST ROUTES =======================✅
// 16. ADD TO WISHLIST
app.post("/wishlist/add", authenticateToken, (req, res) => {
  const { postId } = req.body;


  if (!postId) {
    return res.status(400).json({ success: false, message: "postId is required" });
  }


  const wishlist = loadWishlist();
  const posts = loadPosts();
  const post = posts.find((p) => p.id === postId && p.type === "room");




  if (!wishlist[req.user.id]) {
    wishlist[req.user.id] = [];
  }


  // Check if already in wishlist
  const exists = wishlist[req.user.id].some((id) => id === postId);
  if (exists) {
    return res.status(409).json({
      success: false,
      message: "Room already in wishlist",
    });
  }


  wishlist[req.user.id].push(postId);
  saveWishlist(wishlist);


  res.json({
    success: true,
    message: "Added to wishlist",
    postId,
    total: wishlist[req.user.id].length,
  });
});


// 17. REMOVE FROM WISHLIST
app.post("/wishlist/remove", authenticateToken, (req, res) => {
  const { postId } = req.body;


  if (!postId) {
    return res.status(400).json({ success: false, message: "postId is required" });
  }


  const wishlist = loadWishlist();



  const initialLength = wishlist[req.user.id].length;
  wishlist[req.user.id] = wishlist[req.user.id].filter((id) => id !== postId);


  // Clean up empty user wishlist
  if (wishlist[req.user.id].length === 0) {
    delete wishlist[req.user.id];
  }


  saveWishlist(wishlist);


  res.json({
    success: true,
    message: "Removed from wishlist",
    postId,
    total: wishlist[req.user.id]?.length || 0,
  });
});


// 18. GET USER WISHLIST
app.get("/wishlist", authenticateToken, (req, res) => {
  const wishlist = loadWishlist();
  const wishlistIds = wishlist[req.user.id] || [];


  const posts = loadPosts();
  const wishlistPosts = posts
    .filter((p) => p.type === "room" && wishlistIds.includes(p.id))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((post) => ({
      ...post,
      isInWishlist: true,
    }));


  res.json({
    success: true,
    wishlist: wishlistPosts,
    total: wishlistPosts.length,
  });
});


// 19. CHECK IF POST IS IN WISHLIST
app.get("/wishlist/:postId", authenticateToken, (req, res) => {
  const { postId } = req.params;


  const wishlist = loadWishlist();
  const isInWishlist = wishlist[req.user.id]?.includes(postId) || false;


  res.json({
    success: true,
    postId,
    isInWishlist,
  });
});


// ✅======================= END WISHLIST ROUTES =======================✅


// 🚨 ✅ FIXED: DELETE MY ROOM - SUPPORTS BOTH FIELD NAMES
app.delete("/my-room/:postId", authenticateToken, (req, res) => {
  const { postId } = req.params;


  if (!postId) {
    return res.status(400).json({ success: false, message: "postId is required" });
  }


  const posts = loadPosts();


  // ✅ FIX: Checks both 'poster_user_id' AND 'posteruserid' to avoid 404 on old posts
  const postIndex = posts.findIndex(
    (p) => p.id === postId && p.type === "room" && getPosterUserId(p) === req.user.id
  );


  if (postIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Room post not found or you don't have permission to delete it",
    });
  }


  // Remove from all users' wishlists
  const wishlist = loadWishlist();
  Object.keys(wishlist).forEach((userId) => {
    if (wishlist[userId]) {
      wishlist[userId] = wishlist[userId].filter((id) => id !== postId);
      if (wishlist[userId].length === 0) {
        delete wishlist[userId];
      }
    }
  });
  saveWishlist(wishlist);


  // Delete the post
  posts.splice(postIndex, 1);
  savePosts(posts);


  console.log(`✅ DELETED ROOM: ${postId} by user ${req.user.id}`);


  res.json({
    success: true,
    message: "Room post deleted successfully",
    postId,
  });
});


// ✅ FIXED POST ROOM - PERFECTLY MATCHES FRONTEND FormData
app.post("/post-room", authenticateToken, upload.array("photos", 12), async (req, res) => {
  try {
    console.log("📤 /post-room received:", {
      hasFiles: !!req.files?.length,
      fileCount: req.files?.length || 0,
      bodyKeys: Object.keys(req.body),
    });


    const {
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


    let imageLinks = [];


    // ✅ Handle JSON rent_by_person from frontend
    let parsedRentByPerson = rent_by_person || "";
    try {
      if (typeof rent_by_person === "string") {
        parsedRentByPerson = JSON.parse(rent_by_person);
      }
    } catch (e) {
      console.log("Rent parsing failed, using string:", rent_by_person);
    }


    // ✅ Upload files if present
    if (req.files && req.files.length > 0) {
      console.log(`📸 Uploading ${req.files.length} images to ImgBB...`);
      for (const file of req.files) {
        try {
          const url = await uploadFileToImgBB(file.path);
          imageLinks.push(url);
          console.log("✅ Image uploaded:", url);
        } catch (uploadErr) {
          console.error("❌ Image upload failed:", uploadErr.message);
        }
      }
    }


    const newRoom = {
      id: uuidv4(),
      name: name || "",
      phone: phone || "",
      email: email || "",
      gender: gender || "",
      location: location || "",
      rent_by_person: parsedRentByPerson, // ✅ Properly parsed object/string
      deposit: deposit || "",
      room_type: room_type || "",
      available_from: available_from || "",
      facilities: facilities || "",
      map_link: map_link || "",
      imageLinks,
    };


    const posts = loadPosts();
    posts.push(newRoom);
    savePosts(posts);


    console.log("✅ Room posted successfully:", newRoom.id);


    res.json({
      success: true,
      message: "Room posted successfully",
      links: imageLinks,
      id: newRoom.id,
    });
  } catch (error) {
    console.error("❌ Error in /post-room:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});


// ✅ FIXED: MY ROOMS - Backward compatible
app.get("/my-rooms", authenticateToken, (req, res) => {
  const posts = loadPosts().filter((p) => p.type === "room" && getPosterUserId(p) === req.user.id);
  res.json({
    success: true,
    rooms: posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
  });
});



// ✅ FIXED: MY ROOMMATE POSTS - Backward compatible for OLD posts
app.get("/my-roommate-posts", authenticateToken, (req, res) => {
  const posts = loadPosts().filter(
    (p) => p.type === "roommate" && getPosterUserId(p) === req.user.id
  );
  res.json({
    success: true,
    posts: posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
  });
});


// ✅======================= NEW PRIVATE MESSAGING SYSTEM =======================✅


// ✅ 1. SEND PRIVATE MESSAGE (Room poster ↔ Reply sender)
// ✅ UPDATED: Supports BOTH formats (chatId OR targetUserId/postId)
app.post("/private-message", authenticateToken, (req, res) => {
  const { targetUserId, postId, message, chatId: incomingChatId } = req.body;


  // Common validation
  if (!message || !String(message).trim()) {
    return res.status(400).json({
      success: false,
      message: "message is required",
    });
  }


  // ---- Case B (ROOMMATE-REPLY.html): chatId + message ----
  if (incomingChatId) {
    console.log(`🔍 DEBUG: Using chatId ${incomingChatId}`);
    
    const access = getChatAccessInfo(incomingChatId, req.user.id);
    if (!access.ok) {
      console.log(`❌ ACCESS DENIED: ${access.reason}`);
      return res.status(403).json({ success: false, message: access.reason });
    }


    const messagesStore = loadPrivateMessages();
    const chatId = incomingChatId;


    if (!messagesStore[chatId]) {
      messagesStore[chatId] = [];
    }


    const newMessage = {
      senderId: req.user.id,
      senderName: req.user.name || req.user.phone,
      senderPhone: req.user.phone || "",
      receiverId: access.otherUserId,
      postId: access.postId,
      message: String(message).trim(),
      timestamp: new Date().toISOString(),
      read: false,
    };


    messagesStore[chatId].push(newMessage);
    savePrivateMessages(messagesStore);


    console.log(`💬 MESSAGE via chatId: ${req.user.name} → ${access.otherUserId} (${chatId})`);


    return res.json({
      success: true,
      message: "Message sent successfully",
      chatId,
    });
  }


  // ---- Case A (old): targetUserId + postId + message ----
  if (!targetUserId || !postId) {
    return res.status(400).json({
      success: false,
      message: "targetUserId, postId, and message required (or send chatId + message)",
    });
  }


  console.log(`🔍 DEBUG: Creating new chat ${req.user.id}_${targetUserId}_${postId}`);


  const messagesStore = loadPrivateMessages();
  const builtChatId = `${req.user.id}_${targetUserId}_${postId}`;


  if (!messagesStore[builtChatId]) {
    messagesStore[builtChatId] = [];
  }


  const newMessage = {
    senderId: req.user.id,
    senderName: req.user.name,
    senderPhone: req.user.phone,
    receiverId: targetUserId,
    postId,
    message: String(message).trim(),
    timestamp: new Date().toISOString(),
    read: false,
  };


  messagesStore[builtChatId].push(newMessage);
  savePrivateMessages(messagesStore);


  console.log(`💬 MESSAGE: ${req.user.name} → ${targetUserId} (post:${postId})`);


  return res.json({
    success: true,
    message: "Message sent successfully",
    chatId: builtChatId,
  });
});


// ✅ UPDATED: /my-chats (WhatsApp style - separate chat per post)
app.get("/my-chats", authenticateToken, (req, res) => {
  const messagesStore = loadPrivateMessages();
  const users = loadUsers();
  const chatsArray = [];


  Object.keys(messagesStore).forEach((chatId) => {
    const access = getChatAccessInfo(chatId, req.user.id);
    if (!access.ok) return;


    const thread = messagesStore[chatId] || [];
    if (thread.length === 0) return; // Skip empty chats


    const last = thread[thread.length - 1];
    const otherUser = users.find((u) => u.id === access.otherUserId);


    chatsArray.push({
      chatId, // UNIQUE per post
      otherUserId: access.otherUserId,
      otherUserName: otherUser?.name || "Unknown",
      otherUserPhone: otherUser?.phone || "",
      postId: access.postId, // Different post = different chat
      lastMessage: last?.message || "Say hello! 👋",
      lastMessageTime: last?.timestamp || thread[0]?.timestamp || "",
      createdAt: thread[0]?.timestamp || "",
      totalUnread: thread.filter((m) => !m.read && m.receiverId === req.user.id).length,
    });
  });


  // Sort by latest message time (WhatsApp style)
  chatsArray.sort((a, b) => {
    const ta = new Date(a.lastMessageTime || a.createdAt || 0).getTime();
    const tb = new Date(b.lastMessageTime || b.createdAt || 0).getTime();
    return tb - ta;
  });


  res.json({
    success: true,
    chats: chatsArray,
    totalChats: chatsArray.length,
    totalUnread: chatsArray.reduce((sum, c) => sum + (c.totalUnread || 0), 0),
  });
});


// ✅ 2. GET USER'S ALL PRIVATE CHATS (Shows in Profile)
app.get("/my-messages", authenticateToken, (req, res) => {
  const messages = loadPrivateMessages();
  const allPosts = loadPosts();
  const users = loadUsers();


  const userChats = {};


  // Find all chats where user is sender OR receiver
  Object.keys(messages).forEach((chatId) => {
    // OLD logic kept, but now safer parsing
    const parsed = parseChatId(chatId);
    if (!parsed) return;


    const { user1, user2, postId } = parsed;


    if (user1 === req.user.id || user2 === req.user.id) {
      const otherUserId = user1 === req.user.id ? user2 : user1;
      const otherUser = users.find((u) => u.id === otherUserId);


      if (!userChats[otherUserId]) {
        userChats[otherUserId] = {
          user: otherUser || { id: otherUserId, name: "Unknown", phone: "" },
          postId,
          lastMessage: messages[chatId][messages[chatId].length - 1],
          totalUnread: messages[chatId].filter((m) => !m.read && m.receiverId === req.user.id)
            .length,
          chatId,
        };
      }
    }
  });


  const chatsArray = Object.values(userChats).sort(
    (a, b) => new Date(b.lastMessage?.timestamp) - new Date(a.lastMessage?.timestamp)
  );


  res.json({
    success: true,
    chats: chatsArray,
    totalChats: chatsArray.length,
    totalUnread: chatsArray.reduce((sum, chat) => sum + chat.totalUnread, 0),
  });
});


// ✅ 3. GET SPECIFIC CHAT MESSAGES
// ✅ UPDATED: blocks other users from viewing someone else's chat
// ✅ GET SPECIFIC CHAT MESSAGES (STABLE)
app.get("/chat/:chatId", authenticateToken, (req, res) => {
  const { chatId } = req.params;

  const access = getChatAccessInfo(chatId, req.user.id);
  if (!access.ok) {
    return res.status(403).json({
      success: false,
      message: access.reason,
      chatId,
      messages: [],
      isEmpty: true,
    });
  }

  const messagesStore = loadPrivateMessages();

  res.json({
    success: true,
    chatId,
    messages: messagesStore[chatId] || [],
    isEmpty: !(messagesStore[chatId] && messagesStore[chatId].length > 0),
  });
});




// ✅ SIMPLE TEST ROUTES
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'API Perfect ✅' });
});


app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});


// ✅ 404 Handler - BEFORE error handler


// ✅ ERROR HANDLER - MUST BE LAST
app.use((err, req, res, next) => {
  console.error('❌ ERROR:', err.message);
  res.status(500).json({ error: 'Server error' });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


// ✅======================= END PRIVATE MESSAGING =======================✅


// ✅======================= AUTHENTICATED ROOMMATE ROUTES =======================✅


// ✅ FIXED: ROOMMATE POST - Now stores poster_user_id
app.post("/roommate-post", authenticateToken, (req, res) => {
  const { name, message, gender, phone, email } = req.body;

  const posts = loadPosts();

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
    timestamp: new Date().toISOString()
  };

  posts.push(newPost);
  savePosts(posts);

  res.json({ success: true });
});

// ✅ FIXED: DELETE MY ROOMMATE POST - Backward compatible
app.delete("/my-roommate-post/:postId", authenticateToken, (req, res) => {
  const { postId } = req.params;


  if (!postId) {
    return res.status(400).json({ success: false, message: "postId is required" });
  }


  const posts = loadPosts();
  const postIndex = posts.findIndex(
    (p) => p.id === postId && p.type === "roommate" && getPosterUserId(p) === req.user.id // ✅ Backward compatible
  );


  if (postIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Roommate post not found or you don't have permission to delete it",
    });
  }


  posts.splice(postIndex, 1);
  savePosts(posts);


  console.log(`✅ DELETED ROOMMATE POST: ${postId} by user ${req.user.id}`);


  res.json({
    success: true,
    message: "Roommate post deleted successfully",
    postId,
  });
});


// ✅ FIXED: EDIT MY ROOMMATE POST - Backward compatible
app.patch("/my-roommate-post/:postId", authenticateToken, (req, res) => {
  const { postId } = req.params;
  const updated = req.body;


  const posts = loadPosts();
  const postIndex = posts.findIndex(
    (p) => p.id === postId && p.type === "roommate" && getPosterUserId(p) === req.user.id // ✅ Backward compatible
  );


  if (postIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Roommate post not found or you don't have permission to edit it",
    });
  }


  posts[postIndex] = {
    ...posts[postIndex],
    ...updated,
    updatedAt: new Date().toISOString(),
  };


  savePosts(posts);


  res.json({
    success: true,
    message: "Roommate post updated successfully",
  });
});


// ✅ FIXED: REPLY TO ROOMMATE POST - Backward compatible + Chat link
app.post("/roommate-reply", authenticateToken, (req, res) => {
  const { postId, replyMessage } = req.body;


  console.log("🔍 DEBUG - postId:", postId);
  
  const posts = loadPosts();
  const post = posts.find((p) => p.id === postId);
  
  console.log("🔍 DEBUG - found post:", post);
  
  if (!post || post.type !== "roommate") {
    return res.status(404).json({ success: false, error: "Invalid roommate post." });
  }


  // ✅ NEW: Prevent poster from replying to own post (backward compatible)
  if (getPosterUserId(post) === req.user.id) {
    return res.status(403).json({
      success: false,
      message: "You cannot reply to your own roommate post",
    });
  }



  savePosts(posts);
  res.json({
    success: true,
    chatLink: `${BASE_URL}/ROOMMATE-REPLY.HTML.html?chatId=${req.user.id}_${getPosterUserId(post)}_${postId}`,
  });
});


// ✅ GET SINGLE POST BY ID (Room / Roommate) - Frontend needs this
app.get("/posts/:id", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;


    const posts = loadPosts();
    const post = posts.find((p) => p.id === id);



    // Ensure poster_user_id is always present (backward compatible)
    const postWithOwner = {
      ...post,
      poster_user_id: getPosterUserId(post),
    };


    return res.json({
      success: true,
      post: postWithOwner,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
});

// ✅ PUBLIC ROOMS
app.get("/api/rooms", (req, res) => {

  const { city, type, gender, budget } = req.query;

  let posts = loadPosts().filter(p => p.type === "room" && !p.hidden);

  const filtered = posts.filter((p) => {
    let ok = true;

    if (city) {
      const c = city.toLowerCase();
      const loc = (p.location || "").toLowerCase();
      ok = ok && loc.includes(c);
    }

    if (type) {
      ok = ok && (p.room_type || "").toLowerCase().includes(type.toLowerCase());
    }

    if (gender) {
      ok = ok && (p.gender || "").toLowerCase() === gender.toLowerCase();
    }

    if (budget) {
      const b = parseInt(budget);
      const rentNum = parseInt((p.deposit || "").toString().replace(/\D/g, ""));
      if (!isNaN(b) && !isNaN(rentNum)) {
        ok = ok && rentNum <= b;
      }
    }

    return ok;
  });

  res.json(filtered);
});


// ✅ PUBLIC ROOMMATE POSTS
app.get("/roommate-posts", (req, res) => {
  let posts = loadPosts().filter(p => p.type === "roommate" && !p.hidden);

  posts = posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const postsWithOwner = posts.map(post => ({
    ...post,
    poster_user_id: getPosterUserId(post),
  }));

  res.json(postsWithOwner);
});



// ✅ Rest of admin routes (unchanged)...
app.post("/private-reply", (req, res) => {
  const { postId, senderName, senderEmail, message } = req.body;
  const chats = loadChats();
  if (!chats[postId]) chats[postId] = [];
  chats[postId].push({
    senderName,
    senderEmail,
    message,
    timestamp: new Date().toISOString(),
  });
  saveChats(chats);
  res.json({ success: true });
});


app.get("/private-reply/:postId", (req, res) => {
  res.json(loadChats()[req.params.postId] || []);
});


app.post("/admin-login", (req, res) => {
  const { username, password } = req.body;
  if (username === "findnearroom" && password === "radheradhe@207") {
    res.status(200).send("Login successful");
  } else {
    res.status(401).send("Invalid credentials");
  }
});


app.get("/admin-data", (req, res) => {
  const rooms = loadPosts().filter((p) => p.type === "room");
  const sortedRooms = rooms.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(sortedRooms);
});

app.delete("/delete-room/:id", authenticateToken, (req, res) => {

  const { id } = req.params;

  let posts = loadPosts();

  const index = posts.findIndex(
    p =>
      p.id === id &&
      p.type === "room" &&
      getPosterUserId(p) === req.user.id
  );

  if (index === -1) {
    return res.status(404).json({
      success: false,
      message: "Room not found or not yours"
    });
  }

  posts.splice(index, 1);

  savePosts(posts);

  res.json({
    success: true,
    message: "Room deleted successfully"
  });

});

// ✅ TOGGLE HIDE ROOM BY ID (ADMIN)
app.patch("/toggle-room/:id", (req, res) => {
  const { id } = req.params;

  let posts = loadPosts();
  const index = posts.findIndex(p => p.id === id && p.type === "room");

  if (index === -1) {
    return res.status(404).json({ success: false, message: "Room not found" });
  }

  posts[index].hidden = !posts[index].hidden;

  savePosts(posts);

  res.json({
    success: true,
    hidden: posts[index].hidden
  });
});


// ✅ EDIT ROOM BY ID
app.patch("/edit-room/:id", (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  let posts = loadPosts();

  const postIndex = posts.findIndex(
    (p) => p.id === id && p.type === "room"
  );

  if (postIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Room not found"
    });
  }

  posts[postIndex] = {
    ...posts[postIndex],
    ...updatedData,
    updatedAt: new Date().toISOString()
  };

  savePosts(posts);

  res.json({
    success: true,
    message: "Room updated successfully"
  });
});




app.patch("/roommate-hide/:id", (req, res) => {
  const { id } = req.params;
  const { hidden } = req.body;
  let posts = loadPosts();
  const idx = posts.findIndex((p) => p.id === id && p.type === "roommate");
  if (idx === -1) {
    return res.status(404).json({ success: false, message: "Roommate post not found" });
  }
  posts[idx].hidden = !!hidden;
  savePosts(posts);
  res.json({ success: true, hidden: posts[idx].hidden });
});


app.patch("/roommate-edit/:id", (req, res) => {
  const { id } = req.params;
  const updated = req.body;
  let posts = loadPosts();
  const idx = posts.findIndex((p) => p.id === id && p.type === "roommate");
  if (idx === -1) {
    return res.status(404).json({ success: false, message: "Roommate post not found" });
  }
  posts[idx] = {
    ...posts[idx],
    ...updated,
    updatedAt: new Date().toISOString(),
  };
  savePosts(posts);
  res.json({ success: true });
});
// GET ALL ROOM POSTS (PUBLIC LISTING)
app.get("/room-posts", (req, res) => {

  const { city, type, gender, budget } = req.query;

  let posts = loadPosts()
    .filter(p => p.type === "room" && !p.hidden);

  const filtered = posts.filter((p) => {
    let ok = true;

    if (city) {
      const c = city.toLowerCase();
      const loc = (p.location || "").toLowerCase();
      ok = ok && loc.includes(c);
    }

    if (type) {
      ok = ok && (p.room_type || "").toLowerCase().includes(type.toLowerCase());
    }

    if (gender) {
      const g = (p.gender || "").toLowerCase();

      if (gender.toLowerCase() === "boys" || gender.toLowerCase() === "girls") {
        ok = ok && (g === gender.toLowerCase() || g === "both");
      } else {
        ok = ok && g === gender.toLowerCase();
      }
    }

    if (budget) {
      const b = parseInt(budget);

      let rentNum = 0;

      try {
        if (typeof p.rent_by_person === "object") {
          const values = Object.values(p.rent_by_person).map(v =>
            parseInt(String(v).replace(/\D/g, ""))
          );

          rentNum = Math.min(...values.filter(v => !isNaN(v)));
        } else {
          rentNum = parseInt(
            String(p.rent_by_person || "").replace(/\D/g, "")
          );
        }
      } catch {}

      if (!isNaN(b) && !isNaN(rentNum)) {
        ok = ok && rentNum <= b;
      }
    }

    return ok;
  });

  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json(filtered);
});


// Start Server
  console.log(`✅ Backend running at ${BASE_URL}`);
  console.log("✅ PROTECTED ROUTES:");
  console.log("   POST /post-room (LOGIN REQUIRED)");
  console.log("   POST /roommate-post (LOGIN REQUIRED)");
  console.log("   GET /me");
  console.log("   GET /my-rooms");
  console.log("   DELETE /my-room/:postId");
  console.log("   GET /my-roommate-posts");
  console.log("   DELETE /my-roommate-post/:postId");
  console.log("   PATCH /my-roommate-post/:postId");
  console.log("   POST /roommate-reply");
  console.log("   /wishlist/*");
  console.log("💬 NEW MESSAGING:");
  console.log("   POST /private-message");
  console.log("   GET /my-messages (Profile chats)");
  console.log("   GET /my-chats (roommate-reply.html chats list)");
  console.log("   GET /chat/:chatId");
;
