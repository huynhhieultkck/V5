export const logger = {
  log: (message: string, ...args: any[]) => {
    if (process.env.ENABLE_LOGS === 'true') {
      console.log(`[INFO] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    // Error thường vẫn nên hiện kể cả khi tắt log chung, hoặc tùy bạn cấu hình
    if (process.env.ENABLE_LOGS === 'true') {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }
};