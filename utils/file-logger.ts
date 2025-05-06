import * as fs from 'fs';
import * as path from 'path';

/**
 * Logs a message to the logs.txt file
 * @param message The message or object to log
 */
export function logToFile(...args: any[]): void {
  const formattedMessage = args
    .map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    )
    .join(' ');

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${formattedMessage}\n`;

  try {
    fs.appendFileSync(path.resolve(process.cwd(), 'logs.txt'), logEntry);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}
