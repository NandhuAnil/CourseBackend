require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const links = require("./driveLinks.json");
const cors = require("cors");

const app = express();
app.use(bodyParser.json());
const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || 5500;

app.use(cors({
  origin: "https://www.genius-minds.co.in",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["x-rtb-fingerprint-id"]
}));


app.post("/create", async (req, res) => {
  try {
    const { amount, name, email, phone, course, classstand } = req.body;
    console.log("Incoming body:", req.body);

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET
          ).toString("base64"),
      },
      body: JSON.stringify({
        amount: amount * 100, // paise
        currency: "INR",
        receipt: "receipt_" + Date.now(),
        payment_capture: 1,
        notes: { name, email, phone, course, classstand },
      }),
    });

    const data = await response.json();
    console.log("Razorpay response:", data);

    if (data.error) {
      return res.status(400).json({ success: false, error: data.error });
    }

    res.json({ success: true, order: data });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Webhook (Razorpay will call this after payment)
app.post("/payment", async (req, res) => {
  const {
    name,
    phone,
    email,
    course,
    classstand,
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
  } = req.body;
  console.log("Incoming body:", req.body);
  // ✅ Verify signature
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid payment signature" });
  }

  try {
    // save to sheet / db
    await fetch(process.env.SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        email,
        course,
        classstand,
        payment_id: razorpay_payment_id,
      }),
    });

    // send email with notes
    let downloadLink = links[course]?.[classstand] || links[course]?.[""] || "";
    if (!downloadLink) throw new Error("No download link found");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });

    await transporter.sendMail({
      from: `"Genius Minds" <${process.env.MAIL_USER}>`,
      to: email,
      subject: `${course} Notes & Papers`,
      html: `<p>Dear ${name},</p>
             <p>Thank you for your payment. Click below to download:</p>
             <a href="${downloadLink}" target="_blank">Download Notes</a>`,
    });

    res.json({ success: true, receiptUrl: downloadLink });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
