const jwt = require("jsonwebtoken");
module.exports = function (req, res, next) {
  const header = req.header("Authorization");
  if (!header)
    return res.status(401).json({ message: "No token, authorization denied" });
  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (e) {
    res.status(401).json({ message: "Invalid token" });
  }
};
