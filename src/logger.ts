import { createLogger, format, transports } from "winston";
import dotenv from "dotenv";
dotenv.config();

const logFile = process.env.LOG_FILE || "bot.log";

export const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
    new transports.File({ filename: logFile })
  ],
});

export default logger;
