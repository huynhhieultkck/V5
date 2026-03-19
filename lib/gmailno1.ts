import { logger } from "./logger";
import { randomUUID } from "node:crypto";

/**
 * Service tương tác với API Gmailno1 (Chuẩn Buyer API)
 * Phù hợp với cấu trúc response: { items: [ { product: "..." } ] }
 */
export class GmailNo1Service {
  private domain: string;
  private apiKey: string;

  constructor(domain: string, apiKey: string) {
    let cleanDomain = domain.endsWith('/') ? domain.slice(0, -1) : domain;
    if (cleanDomain.includes('/api/buyer')) {
        cleanDomain = cleanDomain.split('/api/buyer')[0]!;
    }
    this.domain = cleanDomain;
    this.apiKey = apiKey;
  }

  /**
   * Kiểm tra tồn kho
   * Sử dụng trường product_id để so khớp
   */
  async getStock(productId: string | number | null | undefined): Promise<number> {
    if (!productId) return 0;

    try {
      const url = `${this.domain}/api/buyer/products`;
      const res = await fetch(url, {
        headers: { 'X-Buyer-Key': this.apiKey }
      });
      
      const data = await res.json();

      if (data && Array.isArray(data.products)) {
        const targetId = productId.toString();
        
        const product = data.products.find((p: any) => {
            if (!p) return false;
            const pId = p.product_id || p.id;
            return pId && pId.toString() === targetId;
        });
        
        return product ? parseInt(product.stock || '0') : 0;
      }
      return 0;
    } catch (error: any) {
      logger.error(`[GmailNo1] Lỗi check stock tại ${this.domain}:`, error.message);
      return 0;
    }
  }

  /**
   * Thực hiện mua hàng
   * Đáp ứng cấu trúc response thực tế: data.items[].product
   */
  async buyProduct(productId: string | number, quantity: number) {
    try {
      const url = `${this.domain}/api/buyer/order`;
      const idempotencyKey = randomUUID();

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Buyer-Key': this.apiKey,
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({
          product_id: typeof productId === 'string' ? parseInt(productId) : productId,
          quantity: quantity
        })
      });

      const data = await res.json();
      
      // Xử lý thành công dựa trên mẫu: { items: [ { product: "..." } ] }
      if (res.ok && data.items && Array.isArray(data.items)) {
          const accounts = data.items
            .map((item: any) => item.product)
            .filter((content: any) => typeof content === 'string' && content.length > 0);

          return {
              status: 'success',
              data: accounts
          };
      }

      // Xử lý lỗi (ví dụ: Insufficient balance)
      return { 
        status: 'error', 
        msg: data.error || data.message || 'Lỗi không xác định từ Gmailno1' 
      };
    } catch (error: any) {
      logger.error(`[GmailNo1] Lỗi mua hàng tại ${this.domain}:`, error.message);
      return { 
        status: 'error', 
        msg: 'Không thể kết nối tới máy chủ nguồn (Gmailno1)' 
      };
    }
  }
}