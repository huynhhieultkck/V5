import { logger } from "./logger";

/**
 * Service để tương tác với các shop sử dụng source CMSNT (như mail72h, shopvia1s)
 * Dựa trên cấu trúc thực tế từ Postman: 
 * - Stock nằm trong trường 'amount' của object đầu tiên trong mảng 'product'.
 * - Mua hàng trả về mảng 'data' chứa danh sách tài khoản.
 */
export class CMSNTService {
  private domain: string;
  private apiKey: string;

  constructor(domain: string, apiKey: string) {
    // Đảm bảo domain không kết thúc bằng dấu /
    this.domain = domain.endsWith('/') ? domain.slice(0, -1) : domain;
    this.apiKey = apiKey;
  }

  /**
   * Lấy thông tin tồn kho dựa trên image_d910a3.png
   */
  async getStock(productId: string): Promise<number> {
    try {
      const url = `${this.domain}/api/product.php?api_key=${this.apiKey}&product=${productId}`;
      const res = await fetch(url);
      const data = await res.json();

      // Dựa trên ảnh: response có "status": "success" và "product": [ { "amount": ... } ]
      if (data.status === 'success' && Array.isArray(data.product) && data.product.length > 0) {
        const productInfo = data.product[0];
        return parseInt(productInfo.amount || '0');
      }
      return 0;
    } catch (error) {
      logger.error(`[CMSNT] Lỗi check stock tại ${this.domain}:`, error);
      return 0;
    }
  }

  /**
   * Thực hiện mua hàng dựa trên image_d91087.png
   * Trả về danh sách tài khoản nếu thành công
   */
  async buyProduct(productId: string, amount: number, coupon: string = "") {
    try {
      const url = `${this.domain}/api/buy_product`;
      
      // CMSNT yêu cầu form-data
      const formData = new FormData();
      formData.append('action', 'buyProduct');
      formData.append('id', productId);
      formData.append('amount', amount.toString());
      formData.append('coupon', coupon);
      formData.append('api_key', this.apiKey);

      const res = await fetch(url, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      
      /**
       * Kết quả trả về mong đợi:
       * {
       * "status": "success",
       * "msg": "...",
       * "trans_id": "...",
       * "data": ["user|pass|...", "..."]
       * }
       */
      return data;
    } catch (error) {
      logger.error(`[CMSNT] Lỗi kết nối mua hàng tại ${this.domain}:`, error);
      return { 
        status: 'error', 
        msg: 'Không thể kết nối tới máy chủ nguồn (CMSNT)' 
      };
    }
  }
}