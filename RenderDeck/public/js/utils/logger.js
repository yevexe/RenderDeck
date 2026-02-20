
// LOGGER.JS - Centralized Logging System

import { FEATURES } from '../config.js';

export class Logger {
  constructor(debugPanelSelector = '.debug p') {
    this.panel = document.querySelector(debugPanelSelector);
    this.logs = [];
    this.maxLogs = 100;
  }

  log(message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      time: timestamp,
      message: String(message),
      isError
    };

    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest
    }

    // Console logging
    if (FEATURES.ENABLE_DEBUG_LOGGING) {
      if (isError) {
        console.error(`[${timestamp}]`, message);
      } else {
        console.log(`[${timestamp}]`, message);
      }
    }

    // UI logging
    if (this.panel) {
      const line = document.createElement('div');
      line.textContent = `[${timestamp}] ${message}`;
      line.style.color = isError ? '#ff6b6b' : 'inherit';
      
      this.panel.appendChild(line);
      this.panel.scrollTop = this.panel.scrollHeight;
    }
  }

  error(message) {
    this.log(message, true);
  }

  warn(message) {
    this.log(`⚠️ ${message}`, false);
  }

  success(message) {
    this.log(`✓ ${message}`, false);
  }

  clear() {
    this.logs = [];
    if (this.panel) {
      this.panel.innerHTML = '';
    }
  }

  getLogs() {
    return [...this.logs];
  }

  export() {
    const text = this.logs
      .map(l => `[${l.time}] ${l.isError ? 'ERROR: ' : ''}${l.message}`)
      .join('\n');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `renderdeck-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// Create singleton instance
export const logger = new Logger();

// Export convenience functions
export const log = (msg, err) => logger.log(msg, err);
export const logError = (msg) => logger.error(msg);
export const logWarn = (msg) => logger.warn(msg);
export const logSuccess = (msg) => logger.success(msg);