/**
 * Lớp xử lý kết nối với Microsoft Graph API (Mail + OneDrive)
 * Được chuyển đổi từ mẫu ms.js của bạn sang TypeScript
 */

type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  defaultUser: string; // Email quản trị viên (ví dụ: support@vmmo.top)
  defaultFolder?: string;
};

type SendMailOptions = {
  fromUser?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  saveToSentItems?: boolean;
};

export class MicrosoftGraphShop {
  private cfg: GraphConfig;
  private token?: { accessToken: string; expiresAtMs: number };
  private tokenSkewMs = 60_000; // Làm mới token trước 60 giây khi hết hạn

  constructor(cfg: GraphConfig) {
    this.cfg = { ...cfg, defaultFolder: cfg.defaultFolder ?? "" };
  }

  // --- QUẢN LÝ ACCESS TOKEN ---

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.token.expiresAtMs - this.tokenSkewMs) {
      return this.token.accessToken;
    }

    const url = `https://login.microsoftonline.com/${encodeURIComponent(this.cfg.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Lấy token thất bại: ${JSON.stringify(data)}`);

    this.token = { 
      accessToken: data.access_token, 
      expiresAtMs: now + (data.expires_in * 1000) 
    };
    return data.access_token;
  }

  private async graphRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;

    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 204) return undefined as any;
    const data = await res.json();
    if (!res.ok) throw new Error(`Lỗi Graph API: ${JSON.stringify(data)}`);

    return data as T;
  }

  // --- XỬ LÝ ĐƯỜNG DẪN ONEDRIVE ---

  private normFilePath(filePath: string, folder?: string): string {
    if (filePath.startsWith("/")) return filePath.replace(/\/+/g, "/");
    const base = this.cfg.defaultFolder || "";
    const f = folder ?? "";
    const joined = `${base}/${f}/${filePath}`.replace(/\/+/g, "/");
    return joined.startsWith("/") ? joined : `/${joined}`;
  }

  private userPath(user?: string): string {
    return `/users/${encodeURIComponent(user ?? this.cfg.defaultUser)}`;
  }

  // --- ONEDRIVE: UPLOAD FILE ĐƠN HÀNG ---

  /**
   * Tải nội dung text lên OneDrive dưới dạng file .txt
   */
  async uploadText(params: {
    filePath: string; // Tên file (ví dụ: order_id.txt)
    text: string;     // Danh sách tài khoản
    user?: string;
    folder?: string;
    contentType?: string;
  }): Promise<{ id: string; name: string; webUrl: string }> {
    const user = params.user ?? this.cfg.defaultUser;
    const fullPath = this.normFilePath(params.filePath, params.folder);
    
    // Graph API endpoint để tạo/ghi đè file
    const url = `${this.userPath(user)}/drive/root:${fullPath}:/content`;

    const data = await this.graphRequest<any>(url, {
      method: "PUT",
      headers: {
        "Content-Type": params.contentType ?? "text/plain; charset=utf-8",
      },
      body: params.text,
    });

    return { id: data.id, name: data.name, webUrl: data.webUrl };
  }

  /**
   * Đọc nội dung file từ OneDrive (Dùng khi khách hàng muốn xem hàng)
   */
  async readText(params: { filePath: string; user?: string; folder?: string }): Promise<string> {
    const user = params.user ?? this.cfg.defaultUser;
    const fullPath = this.normFilePath(params.filePath, params.folder);
    const url = `${this.userPath(user)}/drive/root:${fullPath}:/content`;
    
    const token = await this.getAccessToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return await res.text();
  }

  // --- MAIL: GỬI EMAIL ---

  async sendMail(opt: SendMailOptions): Promise<void> {
    const fromUser = opt.fromUser ?? this.cfg.defaultUser;
    const body = {
      message: {
        subject: opt.subject,
        body: { contentType: opt.html ? "HTML" : "Text", content: opt.html ?? opt.text },
        toRecipients: (Array.isArray(opt.to) ? opt.to : [opt.to]).map(a => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: opt.saveToSentItems ?? true,
    };

    await this.graphRequest(`${this.userPath(fromUser)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}