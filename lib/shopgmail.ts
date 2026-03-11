import { logger } from "./logger";

/**
 * Service để tương tác với API SHOPGMAIL9999
 * Hỗ trợ các phương thức GET để kiểm tra tồn kho và mua hàng
 */
export class ShopGmailService {
  private domain: string;
  private apiKey: string;

  constructor(domain: string, apiKey: string) {
    // Đảm bảo domain không kết thúc bằng dấu /
    this.domain = domain.endsWith('/') ? domain.slice(0, -1) : domain;
    this.apiKey = apiKey;
  }

  /**
   * Lấy thông tin tồn kho
   * Endpoint: GET /api/BuyGmail/GetstockGmail
   */
  async getStock(productId: string): Promise<number> {
    try {
      const url = `${this.domain}/api/BuyGmail/GetstockGmail?apikey=${this.apiKey}&id=${productId}`;
      const res = await fetch(url, {
        headers: { 'accept': '*/*' }
      });
      const data = await res.json();

      if (data.success === true && data.data && typeof data.data.stock === 'number') {
        return data.data.stock;
      }
      return 0;
    } catch (error: any) {
      logger.error(`[ShopGmail] Lỗi check stock tại ${this.domain}:`, error.message);
      return 0;
    }
  }

  /**
   * Thực hiện mua hàng
   * Endpoint: GET /api/BuyGmail/BuyProduct
   */
  async buyProduct(productId: string, quantity: number) {
    try {
      const url = `${this.domain}/api/BuyGmail/BuyProduct?apikey=${this.apiKey}&quantity=${quantity}&product_id=${productId}`;
      
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'accept': '*/*' }
      });

      const data = await res.json();
      
      /**
       * Kết quả trả về mong đợi:
       * {
       * "success": true,
       * "message": "...",
       * "data": {
       * "accounts": ["email|pass", "..."]
       * }
       * }
       */
      return data;
    } catch (error: any) {
      logger.error(`[ShopGmail] Lỗi kết nối mua hàng tại ${this.domain}:`, error.message);
      return { 
        success: false, 
        message: 'Không thể kết nối tới máy chủ nguồn (SHOPGMAIL9999)' 
      };
    }
  }
}