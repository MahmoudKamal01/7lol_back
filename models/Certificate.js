const mongoose2 = require("mongoose");
const CertificateSchema = new mongoose2.Schema({
  studentId: { type: String, required: true, index: true },
  certificateUrl: { type: String, required: true },
  publicId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose2.model("Certificate", CertificateSchema);
