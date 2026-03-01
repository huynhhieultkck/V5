// msGraphShop.ts
// TypeScript module for Microsoft Graph (OneDrive + Mail) using client_credentials.
// Node 18+ (fetch built-in). If Node < 18, install undici and polyfill fetch.

type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;

  // Mailbox/OneDrive owner you want to act on (e.g. "support@vmmo.top")
  defaultUser: string;

  // Optional: if you want a default folder prefix like "/Orders"
  defaultFolder?: string; // e.g. "/Orders"
};

type SendMailOptions = {
  fromUser?: string; // defaults to config.defaultUser
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  saveToSentItems?: boolean; // default true
};

class GraphError extends Error {
  public status: number;
  public details: any;
  constructor(message: string, status: number, details: any) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.details = details;
  }
}

export class MicrosoftGraphShop {
  private cfg: GraphConfig;

  private token?: { accessToken: string; expiresAtMs: number };
  private tokenSkewMs = 60_000; // refresh 60s before expiry

  constructor(cfg: GraphConfig) {
    if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret || !cfg.defaultUser) {
      throw new Error("Missing required GraphConfig fields.");
    }
    this.cfg = {
      ...cfg,
      defaultFolder: cfg.defaultFolder ?? "",
    };
  }

  // -----------------------------
  // Core: token + request helpers
  // -----------------------------

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.token.expiresAtMs - this.tokenSkewMs) {
      return this.token.accessToken;
    }

    const url = `https://login.microsoftonline.com/${encodeURIComponent(
      this.cfg.tenantId
    )}/oauth2/v2.0/token`;

    const body = new URLSearchParams();
    body.set("client_id", this.cfg.clientId);
    body.set("client_secret", this.cfg.clientSecret);
    body.set("grant_type", "client_credentials");
    body.set("scope", "https://graph.microsoft.com/.default");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new GraphError(
        `Failed to get access token (HTTP ${res.status})`,
        res.status,
        data
      );
    }

    const accessToken = data.access_token as string;
    const expiresIn = Number(data.expires_in ?? 3600);
    this.token = { accessToken, expiresAtMs: now + expiresIn * 1000 };
    return accessToken;
  }

  private async graphRequest<T = any>(
    pathOrUrl: string,
    init: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAccessToken();
    const isFullUrl = /^https?:\/\//i.test(pathOrUrl);
    const url = isFullUrl
      ? pathOrUrl
      : `https://graph.microsoft.com/v1.0${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

    // Some endpoints return no content (204)
    if (res.status === 204) return undefined as any;

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    const payload = isJson ? await res.json().catch(() => ({})) : await res.text();

    if (!res.ok) {
      throw new GraphError(
        `Graph request failed: ${url} (HTTP ${res.status})`,
        res.status,
        payload
      );
    }

    return payload as T;
  }

  private normFolderPath(folder?: string): string {
    const base = this.cfg.defaultFolder || "";
    const f = folder ?? "";
    const joined = `${base}/${f}`.replace(/\/+/g, "/");
    // allow "" or "/Orders/2026/02" etc
    return joined === "/" ? "" : joined.replace(/\/$/, "");
  }

  private normFilePath(filePath: string, folder?: string): string {
    // filePath may already include folder; if it starts with "/" treat as absolute under drive root.
    if (filePath.startsWith("/")) return filePath.replace(/\/+/g, "/");
    const prefix = this.normFolderPath(folder);
    const full = `${prefix}/${filePath}`.replace(/\/+/g, "/");
    return full.startsWith("/") ? full : `/${full}`;
  }

  private userPath(user?: string): string {
    return `/users/${encodeURIComponent(user ?? this.cfg.defaultUser)}`;
  }

  // -----------------------------
  // OneDrive: Upload / Read / Delete / DownloadUrl / Exists
  // -----------------------------

  /**
   * Upload small content (txt/log/json) to OneDrive path.
   * This creates or overwrites the file.
   */
  async uploadText(params: {
    filePath: string; // "order_123.txt" or "/Orders/order_123.txt"
    text: string;
    user?: string;
    folder?: string; // optional extra folder under defaultFolder
    contentType?: string; // default text/plain; charset=utf-8
  }): Promise<{ id: string; name: string; webUrl?: string }> {
    const user = params.user ?? this.cfg.defaultUser;
    const fullPath = this.normFilePath(params.filePath, params.folder);
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
   * Download file content as text.
   */
  async readText(params: {
    filePath: string;
    user?: string;
    folder?: string;
  }): Promise<string> {
    const user = params.user ?? this.cfg.defaultUser;
    const fullPath = this.normFilePath(params.filePath, params.folder);
    const url = `${this.userPath(user)}/drive/root:${fullPath}:/content`;

    // /content returns raw text; our graphRequest tries JSON first -> not JSON -> text
    return await this.graphRequest<string>(url, { method: "GET" });
  }

  /**
   * Delete a file by path.
   */
  async deleteByPath(params: {
    filePath: string;
    user?: string;
    folder?: string;
  }): Promise<void> {
    const user = params.user ?? this.cfg.defaultUser;
    const fullPath = this.normFilePath(params.filePath, params.folder);
    const url = `${this.userPath(user)}/drive/root:${fullPath}`;

    await this.graphRequest<void>(url, { method: "DELETE" });
  }

  /**
   * Get driveItem metadata by path (includes @microsoft.graph.downloadUrl sometimes).
   */
  async getItemMeta(params: {
    filePath: string;
    user?: string;
    folder?: string;
    select?: string[]; // optional select fields
  }): Promise<any> {
    const user = params.user ?? this.cfg.defaultUser;
    const fullPath = this.normFilePath(params.filePath, params.folder);
    const select = params.select?.length ? `?$select=${params.select.join(",")}` : "";
    const url = `${this.userPath(user)}/drive/root:${fullPath}${select}`;

    return await this.graphRequest<any>(url, { method: "GET" });
  }

  /**
   * Get a temporary direct download URL to redirect users (host doesn't stream).
   * Note: URL expires; fetch new each time user clicks.
   */
  async getDownloadUrl(params: {
    filePath: string;
    user?: string;
    folder?: string;
  }): Promise<string> {
    const meta = await this.getItemMeta({
      filePath: params.filePath,
      user: params.user,
      folder: params.folder,
    });

    const url = meta["@microsoft.graph.downloadUrl"];
    if (!url) {
      // Sometimes it may not appear due to permissions/response shape.
      throw new Error("downloadUrl not present in driveItem metadata.");
    }
    return url as string;
  }

  /**
   * Quick existence check.
   */
  async exists(params: { filePath: string; user?: string; folder?: string }): Promise<boolean> {
    try {
      await this.getItemMeta({
        filePath: params.filePath,
        user: params.user,
        folder: params.folder,
        select: ["id"],
      });
      return true;
    } catch (e: any) {
      if (e instanceof GraphError && (e.status === 404 || e.status === 410)) return false;
      throw e;
    }
  }

  // -----------------------------
  // Mail: Send email from a mailbox
  // -----------------------------

  async sendMail(opt: SendMailOptions): Promise<void> {
    const fromUser = opt.fromUser ?? this.cfg.defaultUser;

    const toRecipients = this.toRecipients(opt.to);
    const ccRecipients = opt.cc ? this.toRecipients(opt.cc) : undefined;
    const bccRecipients = opt.bcc ? this.toRecipients(opt.bcc) : undefined;
    const replyTo = opt.replyTo ? this.toRecipients(opt.replyTo) : undefined;

    const contentType = opt.html ? "HTML" : "Text";
    const content = opt.html ?? opt.text ?? "";

    if (!content) throw new Error("sendMail requires either html or text content.");

    const body: any = {
      message: {
        subject: opt.subject,
        body: { contentType, content },
        toRecipients,
        ...(ccRecipients ? { ccRecipients } : {}),
        ...(bccRecipients ? { bccRecipients } : {}),
        ...(replyTo ? { replyTo } : {}),
      },
      saveToSentItems: opt.saveToSentItems ?? true,
    };

    const url = `${this.userPath(fromUser)}/sendMail`;
    await this.graphRequest<void>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private toRecipients(addresses: string | string[]) {
    const arr = Array.isArray(addresses) ? addresses : [addresses];
    return arr.filter(Boolean).map((a) => ({
      emailAddress: { address: a },
    }));
  }
}

// -----------------------------
// Example usage (copy into your code)
// -----------------------------
//
// const graph = new MicrosoftGraphShop({
//   tenantId: process.env.TENANT_ID!,
//   clientId: process.env.CLIENT_ID!,
//   clientSecret: process.env.CLIENT_SECRET!,
//   defaultUser: "support@vmmo.top",
//   defaultFolder: "/Orders" // optional
// });
//
// await graph.uploadText({ filePath: "order_12345.txt", text: "hello" });
// const text = await graph.readText({ filePath: "order_12345.txt" });
// const dl = await graph.getDownloadUrl({ filePath: "order_12345.txt" });
// await graph.sendMail({ to: "buyer@gmail.com", subject: "Order", text: text });