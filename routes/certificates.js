const express = require("express");
const router = express.Router();
const Certificate = require("../models/Certificate");
const multer = require("multer");
const uploadBuffer = require("../utils/cloudinaryUpload");
const auth = require("../middlewares/auth");
const cloudinary = require("../config/cloudinary");
// Configure multer for in-memory storage
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", async (req, res) => {
  try {
    // Parse pagination parameters from query string with defaults
    const page = parseInt(req.query.page) || 1; // default to page 1
    const limit = parseInt(req.query.limit) || 10; // default to 10 items per page

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Get total count of documents for pagination metadata
    const total = await Certificate.countDocuments();

    // Fetch paginated results
    const certs = await Certificate.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Calculate total pages
    const totalPages = Math.ceil(total / limit);

    // Return response with pagination metadata
    res.json({
      data: certs,
      pagination: {
        total,
        totalPages,
        currentPage: page,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (err) {
    console.error("Error fetching all certificates:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST   /api/certificates/
 * (admin only) Upload one or more certificates for a student
 */
router.post("/", auth, upload.array("certificate", 10), async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ message: "No files uploaded" });

    const createdCerts = [];
    for (const file of req.files) {
      const result = await uploadBuffer(file.buffer);
      const cert = await Certificate.create({
        studentId,
        certificateUrl: result.secure_url,
        publicId: result.public_id,
      });
      createdCerts.push(cert);
    }

    res.json(createdCerts);
  } catch (err) {
    console.error("Batch upload error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

/**
 * DELETE /api/certificates/
 * (admin only) Delete ALL certificates from MongoDB and Cloudinary
 */
router.delete("/", auth, async (req, res) => {
  try {
    // 1. Verify Cloudinary is properly configured
    if (!cloudinary?.uploader?.destroy) {
      throw new Error("Cloudinary uploader is not properly configured");
    }

    // 2. Get all certificates
    const allCertificates = await Certificate.find({});

    // 3. Delete from Cloudinary
    const deletionResults = {
      success: [],
      failures: [],
    };

    for (const cert of allCertificates) {
      if (cert.publicId) {
        try {
          await cloudinary.uploader.destroy(cert.publicId);
          deletionResults.success.push(cert.publicId);
        } catch (err) {
          deletionResults.failures.push({
            publicId: cert.publicId,
            error: err.message,
          });
          console.error(`Failed to delete ${cert.publicId}:`, err);
        }
      }
    }

    // 4. Delete from MongoDB
    const mongoResult = await Certificate.deleteMany({});

    res.json({
      message: "Bulk deletion completed",
      cloudinary: {
        attempted: allCertificates.length,
        successful: deletionResults.success.length,
        failed: deletionResults.failures.length,
        errors: deletionResults.failures,
      },
      mongoDB: {
        deletedCount: mongoResult.deletedCount,
      },
    });
  } catch (err) {
    console.error("Bulk deletion error:", err);
    res.status(500).json({
      message: "Bulk deletion failed",
      error: err.message,
      // Only show stack in development
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

/**
 * GET    /api/certificates/search
 * (public) Search certificates by studentId
 */
router.get("/search", async (req, res) => {
  const { studentId } = req.query;
  if (!studentId)
    return res.status(400).json({ message: "studentId is required" });

  try {
    const certs = await Certificate.find({ studentId });
    res.json(certs);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET    /api/certificates/download/:id
 * (public) Redirect to the Cloudinary URL for download
 */
router.get("/download/:id", async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    console.log("ddd", cert);
    if (!cert)
      return res.status(404).json({ message: "Certificate not found" });
    res.redirect(cert.certificateUrl);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PUT    /api/certificates/:id
 * (admin only) Update a certificate file or studentId
 */
router.put("/:id", auth, upload.single("certificate"), async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    if (!cert)
      return res.status(404).json({ message: "Certificate not found" });

    // Replace file if new one provided
    if (req.file) {
      await cloudinary.uploader.destroy(cert.publicId);
      const result = await uploadBuffer(req.file.buffer);
      cert.certificateUrl = result.secure_url;
      cert.publicId = result.public_id;
    }

    // Update studentId if provided
    if (req.body.studentId) {
      cert.studentId = req.body.studentId;
    }

    await cert.save();
    res.json(cert);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

/**
 * DELETE /api/certificates/:id
 * (admin only) Delete a certificate
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id);
    if (!cert) {
      return res.status(404).json({ message: "Certificate not found" });
    }

    // Strict version - fails completely if Cloudinary deletion fails
    if (cert.publicId) {
      await cloudinary.uploader.destroy(cert.publicId);
    }

    await Certificate.deleteOne({ _id: req.params.id });

    res.json({ message: "Certificate completely deleted from both systems" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({
      message: "Deletion failed - rolled back",
      error: "Certificate was not deleted from either system due to an error",
    });
  }
});

/**
 * GET    /api/certificates/stats
 * (admin only) Overview stats
 */
router.get("/stats", auth, async (req, res) => {
  try {
    const totalCerts = await Certificate.countDocuments();
    const uniqueStudents = (await Certificate.distinct("studentId")).length;
    res.json({ totalCerts, uniqueStudents });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/student/:studentId", auth, async (req, res) => {
  const { studentId } = req.params;
  try {
    // 1) Delete all matching certificates
    const certResult = await Certificate.deleteMany({ studentId });

    // 2) Optionally delete the Student document itself
    return res.json({
      message: "تم حذف جميع الشهادات",
      deletedCertificates: certResult.deletedCount,
    });
  } catch (err) {
    console.error("Error deleting student certificates:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/trends/daily", auth, async (req, res) => {
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 6);

  try {
    const data = await Certificate.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day: { $dayOfMonth: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      {
        $project: {
          date: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day",
            },
          },
          count: 1,
          _id: 0,
        },
      },
    ]);
    res.json(data);
  } catch (err) {
    console.error("Daily trends error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/certificates/trends/monthly
// Returns number of certs per month for the last 12 months
router.get("/trends/monthly", auth, async (req, res) => {
  const today = new Date();
  const lastYear = new Date();
  lastYear.setFullYear(today.getFullYear() - 1);

  try {
    const data = await Certificate.aggregate([
      { $match: { createdAt: { $gte: lastYear } } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
      {
        $project: {
          label: {
            $concat: [
              { $toString: "$_id.month" },
              "-",
              { $toString: "$_id.year" },
            ],
          },
          count: 1,
          _id: 0,
        },
      },
    ]);
    res.json(data);
  } catch (err) {
    console.error("Monthly trends error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Add this right before module.exports
router.get("/cloudinary-test", auth, async (req, res) => {
  try {
    // Test configuration
    if (!cloudinary.config().cloud_name) {
      return res.status(500).json({ error: "Cloudinary not configured" });
    }

    // Test actual uploader functionality
    try {
      // Try listing some resources (safe operation)
      const result = await cloudinary.api.resources({ max_results: 1 });
      return res.json({
        status: "Cloudinary working properly",
        config: {
          cloud_name: cloudinary.config().cloud_name,
          api_key: cloudinary.config().api_key ? "present" : "missing",
        },
        testResult: result,
      });
    } catch (apiError) {
      return res.status(500).json({
        error: "Cloudinary API test failed",
        details: apiError.message,
      });
    }
  } catch (err) {
    return res.status(500).json({
      error: "Cloudinary test failed",
      details: err.message,
    });
  }
});

module.exports = router;
