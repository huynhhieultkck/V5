import { MicrosoftGraphShop } from "./graph";

// Khởi tạo instance Microsoft Graph với thông tin từ Postman của bạn
// Bạn nên thêm các biến này vào file .env
export const mailService = new MicrosoftGraphShop({
  tenantId: process.env.MS_TENANT_ID || "3d73530e-c904-4105-be9c-c54b77706caa",
  clientId: process.env.MS_CLIENT_ID || "d7f730e5-65c0-4aac-b892-3f3075ef9dd6",
  clientSecret: process.env.MS_CLIENT_SECRET || "R2X8Q~cPhoCQZ1zhqQ5HkKqs._oDPG7py2RHEbWX",
  defaultUser: process.env.MS_MAIL_SENDER || "support@vmmo.top",
});