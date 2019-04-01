import winston from "winston";

export default winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  ),
  // format: winston.format.json(),
  transports: [new winston.transports.Console()]
});
