/**
 * Lớp xử lý kết nối với Microsoft Graph API (Mail + OneDrive)
 */

type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  defaultUser: string; 
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
  private tokenSkewMs = 60_000; 

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
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const tokenData = await res.json();
    if (!res.ok) throw new Error(`Lấy token thất bại: ${JSON.stringify(tokenData)}`);

    this.token = { 
      accessToken: tokenData.access_token, 
      expiresAtMs: now + (tokenData.expires_in * 1000) 
    };
    return tokenData.access_token;
  }

  /**
   * Phương thức thực hiện request tới Graph API
   * Đã sửa để xử lý các phản hồi 202/204 trống một cách an toàn
   */
  private async graphRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;

    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    });

    // 1. Xử lý các mã trạng thái thành công nhưng không có nội dung (thường là sendMail trả về 202)
    if (res.status === 204 || res.status === 202) {
      return {} as T;
    }
    
    // 2. Đọc dưới dạng văn bản trước để tránh lỗi "Unexpected end of JSON"
    const text = await res.text();
    
    if (!res.ok) {
      throw new Error(`Graph API Error [${res.status}]: ${text || res.statusText}`);
    }

    // 3. Chỉ phân giải JSON nếu văn bản không trống
    try {
      return text ? JSON.parse(text) : ({} as T);
    } catch (e) {
      // Fallback nếu kết quả không phải JSON nhưng status là OK
      return text as any;
    }
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

  async uploadText(params: {
    filePath: string; 
    text: string;     
    user?: string;
    folder?: string;
    contentType?: string;
  }): Promise<{ id: string; name: string; webUrl: string }> {
    const user = params.user ?? this.cfg.defaultUser;
    const fullPath = this.normFilePath(params.filePath, params.folder);
    
    const url = `${this.userPath(user)}/drive/root:${fullPath}:/content`;

    const uploadInfo = await this.graphRequest<any>(url, {
      method: "PUT",
      headers: {
        "Content-Type": params.contentType ?? "text/plain; charset=utf-8",
      },
      body: params.text,
    });

    return { id: uploadInfo.id, name: uploadInfo.name, webUrl: uploadInfo.webUrl };
  }

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

    // sendMail thường trả về 202 và graphRequest mới đã xử lý việc này
    await this.graphRequest(`${this.userPath(fromUser)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}