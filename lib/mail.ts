import { MicrosoftGraphShop } from "./graph";

// Khởi tạo instance Microsoft Graph với thông tin từ Postman của bạn
// Bạn nên thêm các biến này vào file .env
export const mailService = new MicrosoftGraphShop({
  tenantId: process.env.MS_TENANT_ID || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
  clientId: process.env.MS_CLIENT_ID || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
  clientSecret: process.env.MS_CLIENT_SECRET || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
  defaultUser: process.env.MS_MAIL_SENDER || "support@vmmo.top",
});